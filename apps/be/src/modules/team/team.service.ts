import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  Member as MemberContract,
  MemberRole,
  Workspace as WorkspaceContract,
} from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { transactionWithEffects } from '../../common/utils';
import type { AuthContext } from '../../common/types';
import { AccountService } from '../account/account.service';
import { SeatSyncService } from '../billing/seat-sync.service';
import { StripeGateway } from '../billing/stripe.gateway';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events';
import { Member } from '../workspace/entities/member.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { toMember, toWorkspace } from '../workspace/workspace.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import {
  DeleteWorkspaceDto,
  TransferOwnershipDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
} from './dto/team.dto';

const LIVE_SUBSCRIPTION = ['active', 'trialing', 'past_due'];

/** Roles, removal, ownership transfer, rename and delete of the caller's workspace. */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workspaces: WorkspaceService,
    private readonly account: AccountService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly seats: SeatSyncService,
    private readonly stripe: StripeGateway,
    private readonly clock: ClockService,
  ) {}

  async changeRole(
    auth: AuthContext,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<MemberContract> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lockActor(manager, auth, ['owner']);
      const target = await this.findTarget(manager, auth.workspaceId, memberId);
      if (target.id === auth.memberId) {
        throw new BadRequestException({ message: 'workspace.CANNOT_CHANGE_SELF' });
      }
      if (target.role === 'owner') {
        throw new BadRequestException({ message: 'workspace.CANNOT_CHANGE_OWNER' });
      }
      if (target.role !== dto.role) {
        const from = target.role;
        await manager.update(Member, { id: target.id }, { role: dto.role });
        target.role = dto.role;
        if (dto.role === 'member') {
          // A pairing code is an admin power: it does not outlive the role that created it.
          await manager.query(
            `UPDATE pairing_codes SET used_at = $2
             WHERE created_by = $1 AND used_at IS NULL`,
            [target.id, this.clock.now()],
          );
        }
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'member.role_changed',
            targetType: 'member',
            targetId: target.id,
            meta: { from, to: dto.role },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => this.events.publish(auth.workspaceId, { type: 'members.changed' }));
      }
      return toMember(target);
    });
  }

  /** Owner removes anyone but self; an admin removes plain members only. */
  async removeMember(auth: AuthContext, memberId: string): Promise<void> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const actor = await this.lockActor(manager, auth, ['owner', 'admin']);
      const target = await this.findTarget(manager, auth.workspaceId, memberId);
      if (target.id === actor.id) {
        throw new BadRequestException({ message: 'workspace.CANNOT_REMOVE_SELF' });
      }
      if (actor.role === 'admin' && target.role !== 'member') {
        throw new ForbiddenException({ message: 'workspace.CANNOT_REMOVE_TARGET' });
      }
      const counts = await this.workspaces.removeMember(manager, target.id, {}, effects);
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: actor.id,
          action: 'member.removed',
          targetType: 'member',
          targetId: target.id,
          meta: { name: target.name, role: target.role, ...counts },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(auth.workspaceId, { type: 'members.changed' }));
    });
    await this.seats.sync(auth.workspaceId); // after the commit, best-effort
  }

  /** The target becomes owner and the caller admin, in one transaction. */
  async transferOwnership(auth: AuthContext, dto: TransferOwnershipDto): Promise<void> {
    await this.account.checkPassword(auth, dto.password);
    let newOwnerEmail = '';
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const actor = await this.lockActor(manager, auth, ['owner']);
      const target = await this.findTarget(manager, auth.workspaceId, dto.memberId);
      if (target.id === actor.id) {
        throw new BadRequestException({ message: 'workspace.CANNOT_TRANSFER_TO_SELF' });
      }
      newOwnerEmail = target.email;
      await manager.update(Member, { id: target.id }, { role: 'owner' satisfies MemberRole });
      await manager.update(Member, { id: actor.id }, { role: 'admin' satisfies MemberRole });
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: actor.id,
          action: 'workspace.ownership_transferred',
          targetType: 'member',
          targetId: target.id,
          meta: { from: actor.id, to: target.id, previousRole: target.role },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => {
        this.events.publish(auth.workspaceId, { type: 'members.changed' });
        this.events.publish(auth.workspaceId, { type: 'workspace.changed' });
      });
    });
    await this.syncBillingEmail(auth.workspaceId, newOwnerEmail); // after the commit, best-effort
  }

  async rename(auth: AuthContext, dto: UpdateWorkspaceDto): Promise<WorkspaceContract> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lockActor(manager, auth, ['owner', 'admin']);
      const workspace = await manager.findOneOrFail(Workspace, { where: { id: auth.workspaceId } });
      if (workspace.name !== dto.name) {
        const from = workspace.name;
        // The slug stays: it is an identifier, not a label.
        await manager.update(Workspace, { id: workspace.id }, { name: dto.name });
        workspace.name = dto.name;
        await this.audit.record(
          {
            workspaceId: workspace.id,
            actorMemberId: auth.memberId,
            action: 'workspace.renamed',
            targetType: 'workspace',
            targetId: workspace.id,
            meta: { from, to: dto.name },
            ip: auth.ip,
          },
          manager,
        );
        effects.push(() => this.events.publish(workspace.id, { type: 'workspace.changed' }));
      }
      return toWorkspace(workspace);
    });
  }

  /** Hard delete: every table cascades from `workspaces`. Nothing is audited (the rows go too). */
  async deleteWorkspace(auth: AuthContext, dto: DeleteWorkspaceDto): Promise<void> {
    const workspace = await this.workspaces.findWorkspace(auth.workspaceId);
    if (!workspace || workspace.name !== dto.confirmName) {
      throw new BadRequestException({ message: 'workspace.CONFIRM_NAME_MISMATCH' });
    }
    await this.account.checkPassword(auth, dto.password);
    // Never leave the customer billed for a workspace that no longer exists. The cancellation runs
    // before the transaction (no locks held across a network call) and a failure aborts the delete.
    // If the state changes before the delete below, deleting anyway is fine: it is cancelled.
    const [row] = await this.dataSource.query<{ sub: string | null; status: string | null }[]>(
      'SELECT stripe_subscription_id AS sub, subscription_status AS status FROM workspaces WHERE id = $1',
      [auth.workspaceId],
    );
    if (row?.sub && row.status && LIVE_SUBSCRIPTION.includes(row.status)) {
      try {
        await this.stripe.cancelSubscription(row.sub);
      } catch (error) {
        this.logger.error(
          `Cancelling subscription of workspace ${auth.workspaceId} failed: ${String(error)}`,
        );
        throw new ConflictException({ message: 'billing.CANCEL_FAILED' });
      }
    }
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      // Same advisory lock as the task engine, so no command runs against a half-deleted workspace.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [auth.workspaceId]);
      await this.lockActor(manager, auth, ['owner']);
      await manager.delete(Workspace, { id: auth.workspaceId });
      effects.push(() => this.events.closeWorkspaceStreams(auth.workspaceId));
    });
    this.logger.log(`Workspace ${auth.workspaceId} deleted by member ${auth.memberId}`);
  }

  /** Keeps the Stripe customer's email on the current owner. A Stripe error is logged only. */
  private async syncBillingEmail(workspaceId: string, email: string): Promise<void> {
    try {
      const [row] = await this.dataSource.query<{ customer: string | null }[]>(
        'SELECT stripe_customer_id AS customer FROM workspaces WHERE id = $1',
        [workspaceId],
      );
      if (row?.customer && email) await this.stripe.updateCustomerEmail(row.customer, email);
    } catch (error) {
      this.logger.error(`Billing email sync failed for workspace ${workspaceId}: ${String(error)}`);
    }
  }

  /**
   * Locks the workspace row (serialising role changes, removals and transfers) and re-reads the
   * caller from the database: the guard's answer may be a moment old.
   */
  private async lockActor(
    manager: EntityManager,
    auth: AuthContext,
    allowed: MemberRole[],
  ): Promise<Member> {
    await manager.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [auth.workspaceId]);
    const actor = await manager.findOne(Member, {
      where: { id: auth.memberId, workspaceId: auth.workspaceId },
    });
    if (!actor || actor.removedAt || !allowed.includes(actor.role as MemberRole)) {
      throw new ForbiddenException({ message: 'auth.FORBIDDEN' });
    }
    return actor;
  }

  /** A live member of the caller's workspace; foreign, removed or malformed ids are a 404. */
  private async findTarget(
    manager: EntityManager,
    workspaceId: string,
    memberId: string,
  ): Promise<Member> {
    const target = isUUID(memberId)
      ? await manager.findOne(Member, { where: { id: memberId, workspaceId } })
      : null;
    if (!target || target.removedAt)
      throw new NotFoundException({ message: 'workspace.MEMBER_NOT_FOUND' });
    return target;
  }
}

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AuthResult,
  CreateInviteResult,
  Invite as InviteContract,
  InvitePreview,
  isStrongPassword,
  WorkspacePlan,
} from '@repo/shared';
import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { isUUID } from 'class-validator';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { RequestMeta } from '../../common/decorators';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects } from '../../common/utils';
import { appConfig, authConfig } from '../../config';
import { AuditService } from '../audit/audit.service';
import { hashToken, TokenService } from '../auth/token.service';
import { EventsService } from '../events';
import { buildAppLink } from '../mail/templates';
import { MailService } from '../mail/mail.service';
import { SeatSyncService } from '../billing/seat-sync.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { Member } from '../workspace/entities/member.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { joinDefaultRooms, lockRooms } from '../chat/room-access';
import { findLiveDepartment, joinDepartmentRoom } from '../departments/department-access';
import { Department } from '../departments/entities/department.entity';
import { toSession } from '../workspace/workspace.mapper';
import { AcceptInviteDto, CreateInviteDto } from './dto/team.dto';
import { Invite } from './entities/invite.entity';

export const INVITE_TTL_MS = 7 * 24 * 3_600_000;

const PG_UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_CONSTRAINT = 'UQ_members_email';

interface InviteRow {
  id: string;
  email: string;
  role: 'admin' | 'member';
  department_id: string | null;
  title: string | null;
  created_at: Date;
  expires_at: Date;
  inviter_name: string | null;
}

const toInvite = (row: InviteRow): InviteContract => ({
  id: row.id,
  email: row.email,
  role: row.role,
  departmentId: row.department_id,
  title: row.title,
  invitedByName: row.inviter_name,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

@Injectable()
export class InvitesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly limits: PlanLimitsService,
    private readonly seats: SeatSyncService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  /**
   * Creates an invite (replacing a pending one for the same address) and mails it. The raw
   * token is returned once: the hash is all that is stored.
   */
  async create(auth: AuthContext, dto: CreateInviteDto): Promise<CreateInviteResult> {
    if (dto.role === 'admin' && auth.role !== 'owner') {
      throw new ForbiddenException({ message: 'invites.ADMIN_REQUIRES_OWNER' });
    }
    const now = this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const created = await transactionWithEffects(this.dataSource, async (manager, effects) => {
      // Serialises two invites for one address so the partial unique index is never the answer.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
        `invite:${auth.workspaceId}:${dto.email}`,
      ]);
      // Same workspace row lock as the team commands: the role is re-checked against a settled
      // state, and the seat count below cannot be outrun by a parallel invite or accept.
      const plan = await this.limits.lockPlan(manager, auth.workspaceId);
      const actor = await manager.findOne(Member, {
        where: { id: auth.memberId, workspaceId: auth.workspaceId },
        relations: { workspace: true },
      });
      if (!actor || actor.removedAt || !['owner', 'admin'].includes(actor.role)) {
        throw new ForbiddenException({ message: 'auth.FORBIDDEN' });
      }
      if (dto.role === 'admin' && actor.role !== 'owner') {
        throw new ForbiddenException({ message: 'invites.ADMIN_REQUIRES_OWNER' });
      }
      if (dto.departmentId !== undefined) {
        await findLiveDepartment(manager, auth.workspaceId, dto.departmentId);
      }
      // Only this workspace's members are checked: an address registered elsewhere must not be
      // discoverable here. Removed members had their address rewritten, so this matches live ones.
      if (
        await manager.exists(Member, {
          where: { email: dto.email, workspaceId: auth.workspaceId, removedAt: IsNull() },
        })
      ) {
        throw new ConflictException({ message: 'invites.ALREADY_MEMBER' });
      }
      const replaced = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE invites SET revoked_at = $3
           WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL
           RETURNING id`,
          [auth.workspaceId, dto.email, now],
        ),
      );
      // After the replaced invite is revoked: replacing one never needs a second seat.
      await this.limits.assertCanAdd(manager, auth.workspaceId, plan, 'seats');
      const row = await manager.save(
        manager.create(Invite, {
          workspaceId: auth.workspaceId,
          email: dto.email,
          role: dto.role,
          departmentId: dto.departmentId ?? null,
          title: dto.title ?? null,
          tokenHash: hashToken(token),
          invitedBy: actor.id,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          acceptedAt: null,
          revokedAt: null,
          createdAt: now,
        }),
      );
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: actor.id,
          action: 'invite.created',
          targetType: 'invite',
          targetId: row.id,
          meta: {
            email: dto.email,
            role: dto.role,
            replaced: replaced.length,
            departmentId: row.departmentId,
            title: row.title,
          },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => {
        this.mail.sendInvite(dto.email, actor.name, actor.workspace.name, token);
        this.events.publish(auth.workspaceId, { type: 'members.changed' });
      });
      return {
        invite: toInvite({
          id: row.id,
          email: row.email,
          role: row.role,
          department_id: row.departmentId,
          title: row.title,
          created_at: row.createdAt,
          expires_at: row.expiresAt,
          inviter_name: actor.name,
        }),
      };
    });
    return {
      invite: created.invite,
      token,
      url: buildAppLink(this.app.appUrl, 'invite', token),
    };
  }

  /** Pending and still valid, newest first. */
  async list(workspaceId: string): Promise<InviteContract[]> {
    const rows = await this.dataSource.query<InviteRow[]>(
      `SELECT i.id, i.email, i.role, i.department_id, i.title, i.created_at, i.expires_at,
              m.name AS inviter_name
       FROM invites i LEFT JOIN members m ON m.id = i.invited_by
       WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > $2
       ORDER BY i.created_at DESC, i.id DESC`,
      [workspaceId, this.clock.now()],
    );
    return rows.map(toInvite);
  }

  async revoke(auth: AuthContext, inviteId: string): Promise<void> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const rows = isUUID(inviteId)
        ? returnedRows<{ email: string }>(
            await manager.query(
              `UPDATE invites SET revoked_at = $3
               WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
               RETURNING email`,
              [inviteId, auth.workspaceId, this.clock.now()],
            ),
          )
        : [];
      if (!rows[0]) throw new NotFoundException({ message: 'invites.NOT_FOUND' });
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'invite.revoked',
          targetType: 'invite',
          targetId: inviteId,
          meta: { email: rows[0].email },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(auth.workspaceId, { type: 'members.changed' }));
    });
  }

  /** Public: valid means pending, unrevoked and unexpired; anything else is the same 404. */
  async preview(token: string): Promise<InvitePreview> {
    const rows = await this.dataSource.query<(InviteRow & { workspace_name: string })[]>(
      `SELECT i.id, i.email, i.role, i.department_id, i.title, i.created_at, i.expires_at,
              m.name AS inviter_name, w.name AS workspace_name
       FROM invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN members m ON m.id = i.invited_by
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > $2`,
      [hashToken(token), this.clock.now()],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException({ message: 'invites.INVALID' });
    return {
      workspaceName: row.workspace_name,
      email: row.email,
      role: row.role,
      invitedByName: row.inviter_name,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /** Public: redeems the invite and signs the new member in. */
  async accept(dto: AcceptInviteDto, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await argon2.hash(dto.password, this.auth.argon2);
    try {
      const result = await transactionWithEffects(this.dataSource, async (manager, effects) => {
        const now = this.clock.now();
        // Lock rooms, then the workspace (a concurrent delete waits or has already won), then redeem.
        const pending = returnedRows<{ workspace_id: string }>(
          await manager.query(
            `SELECT workspace_id FROM invites WHERE token_hash = $1 AND accepted_at IS NULL
               AND revoked_at IS NULL AND expires_at > $2`,
            [hashToken(dto.token), now],
          ),
        )[0];
        if (!pending) throw new NotFoundException({ message: 'invites.INVALID' });
        // Lock order: the rooms lock (a concurrent department delete holds it) before the
        // workspaces row, as in `removeMember`. The department read below is then stable.
        await lockRooms(manager, pending.workspace_id);
        const locked = returnedRows<{ id: string; plan: WorkspacePlan }>(
          await manager.query('SELECT id, plan FROM workspaces WHERE id = $1 FOR UPDATE', [
            pending.workspace_id,
          ]),
        );
        if (!locked[0]) throw new NotFoundException({ message: 'invites.INVALID' });
        // One conditional UPDATE: two parallel accepts cannot both win.
        const rows = returnedRows<{
          id: string;
          workspace_id: string;
          email: string;
          role: 'admin' | 'member';
          department_id: string | null;
          title: string | null;
        }>(
          await manager.query(
            `UPDATE invites SET accepted_at = $2
             WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
               AND expires_at > $2
             RETURNING id, workspace_id, email, role, department_id, title`,
            [hashToken(dto.token), now],
          ),
        );
        const invite = rows[0];
        if (!invite) throw new NotFoundException({ message: 'invites.INVALID' });
        // Inside the transaction: a rejected password does not burn the invite.
        if (!isStrongPassword(dto.password, invite.email)) {
          throw new BadRequestException({ message: 'auth.WEAK_PASSWORD' });
        }
        // Redeemed invite no longer counts as pending: its member needs a seat of its own.
        await this.limits.assertCanAdd(manager, invite.workspace_id, locked[0].plan, 'seats');
        const workspace = await manager.findOne(Workspace, {
          where: { id: invite.workspace_id },
        });
        if (!workspace) throw new NotFoundException({ message: 'invites.INVALID' });
        // The department may have been deleted since (its invites were cleared then); a live
        // one is checked again here so a late delete is never joined.
        const department = invite.department_id
          ? await manager.findOne(Department, {
              where: { id: invite.department_id, workspaceId: workspace.id },
            })
          : null;
        const member = await manager.save(
          manager.create(Member, {
            workspaceId: workspace.id,
            name: dto.name,
            email: invite.email,
            passwordHash,
            role: invite.role,
            color: null,
            departmentId: department?.id ?? null,
            title: invite.title,
            // The invite reached this address, which is the verification.
            emailVerifiedAt: now,
            termsAcceptedAt: now,
            passwordChangedAt: now,
          }),
        );
        await joinDefaultRooms(manager, workspace.id, member.id);
        if (department) await joinDepartmentRoom(manager, department, { memberId: member.id });
        const pair = await this.tokens.issuePair(manager, member, randomUUID(), meta);
        await this.audit.record(
          {
            workspaceId: workspace.id,
            actorMemberId: member.id,
            action: 'invite.accepted',
            targetType: 'invite',
            targetId: invite.id,
            meta: { role: invite.role, departmentId: member.departmentId },
            ip: meta.ip,
          },
          manager,
        );
        effects.push(() => {
          this.events.publish(workspace.id, { type: 'members.changed' });
          if (department) this.events.publish(workspace.id, { type: 'departments.changed' });
        });
        return { session: toSession(member, workspace), ...pair };
      });
      await this.seats.sync(result.session.workspace.id); // after the commit, best-effort
      return result;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string; constraint?: string } | undefined)?.code ===
          PG_UNIQUE_VIOLATION &&
        (error.driverError as { constraint?: string }).constraint === EMAIL_UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException({ message: 'auth.EMAIL_TAKEN' });
      }
      throw error;
    }
  }
}

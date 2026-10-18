import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Member as MemberContract, MemberRole, Session } from '@repo/shared';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows, type AfterCommit } from '../../common/utils';
import { TaskActivityRow } from '../tasks/entities/task-activity.entity';
import { leaveAllRooms, lockRooms } from '../chat/room-access';
import { EventsService } from '../events';
import { Member } from './entities/member.entity';
import { Workspace } from './entities/workspace.entity';
import { slugify } from './slug.util';
import { toMember, toSession } from './workspace.mapper';

export interface CreateWorkspaceWithOwnerInput {
  name: string;
  email: string;
  passwordHash: string;
  workspaceName: string;
  termsAcceptedAt: Date;
}

export interface RemovedMemberCounts {
  revokedInvites: number;
  revokedPairingCodes: number;
  unassignedTasks: number;
}

/** Name shown for a member who deleted their own account (an i18n-neutral literal on purpose). */
export const DELETED_MEMBER_NAME = 'Deleted user';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  /** Runs inside the caller's transaction. Unique violations (email/slug) propagate. */
  async createWithOwner(
    manager: EntityManager,
    input: CreateWorkspaceWithOwnerInput,
  ): Promise<{ member: Member; workspace: Workspace }> {
    const workspace = await manager.save(
      manager.create(Workspace, {
        name: input.workspaceName,
        slug: await this.uniqueSlug(manager, slugify(input.workspaceName)),
        onboardedAt: null,
      }),
    );
    const member = await manager.save(
      manager.create(Member, {
        workspaceId: workspace.id,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'owner' satisfies MemberRole,
        color: null,
        termsAcceptedAt: input.termsAcceptedAt,
        passwordChangedAt: input.termsAcceptedAt,
      }),
    );
    return { member, workspace };
  }

  async getSession(memberId: string): Promise<Session> {
    const member = await this.members.findOne({
      where: { id: memberId },
      relations: { workspace: true },
    });
    if (!member || member.removedAt)
      throw new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
    return toSession(member, member.workspace);
  }

  async listMembers(workspaceId: string): Promise<MemberContract[]> {
    const rows = await this.members.find({
      where: { workspaceId, removedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map(toMember);
  }

  /**
   * Soft-removes a member inside the caller's transaction: the row stays (history keeps its
   * author and name) but every refresh family is revoked, the email is rewritten so the address
   * is free again, `removed_at` is set, and (after the commit, through `effects`) the member's
   * open event streams are closed. `scrubName` also replaces the stored name (self-deletion).
   * The login and the JWT guard reject removed members, and `listMembers` hides them.
   */
  async removeMember(
    manager: EntityManager,
    memberId: string,
    options: { scrubName?: boolean },
    effects: AfterCommit[],
  ): Promise<RemovedMemberCounts> {
    const now = this.clock.now();
    // Room commands serialize on this lock (callers take it first, before their own row locks,
    // so the lock order stays the same everywhere).
    const [{ workspace_id: workspaceId }] = returnedRows<{ workspace_id: string }>(
      await manager.query('SELECT workspace_id FROM members WHERE id = $1', [memberId]),
    );
    await lockRooms(manager, workspaceId);
    await manager.query(
      'UPDATE refresh_tokens SET revoked_at = $2 WHERE member_id = $1 AND revoked_at IS NULL',
      [memberId, now],
    );
    // Read cursors are per member and meaningless afterwards. There are no per-member drafts:
    // draft replies belong to a connection's room, so they stay.
    await manager.query('DELETE FROM thread_reads WHERE member_id = $1', [memberId]);
    for (const table of ['room_reads', 'room_mutes', 'thread_mutes', 'pins']) {
      await manager.query(`DELETE FROM ${table} WHERE member_id = $1`, [memberId]);
    }
    const left = await leaveAllRooms(manager, memberId);
    await manager.update(
      Member,
      { id: memberId },
      {
        email: `removed+${memberId}@removed.invalid`,
        removedAt: now,
        ...(options.scrubName ? { name: DELETED_MEMBER_NAME } : {}),
      },
    );
    const member = await manager.findOneOrFail(Member, { where: { id: memberId } });
    // Nothing the member started may stay usable: pending invites and unused pairing codes.
    const invites = returnedRows<{ id: string }>(
      await manager.query(
        `UPDATE invites SET revoked_at = $2
         WHERE invited_by = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
        [memberId, now],
      ),
    );
    const codes = returnedRows<{ id: string }>(
      await manager.query(
        `UPDATE pairing_codes SET used_at = $2
         WHERE created_by = $1 AND used_at IS NULL RETURNING id`,
        [memberId, now],
      ),
    );
    // Their open tasks go back to the unassigned pool (status unchanged); done tasks keep history.
    const tasks = returnedRows<{ id: string }>(
      await manager.query(
        `UPDATE tasks SET assignee_member_id = NULL
         WHERE workspace_id = $1 AND assignee_member_id = $2 AND status <> 'done' RETURNING id`,
        [member.workspaceId, memberId],
      ),
    );
    for (const task of tasks) {
      await manager.insert(TaskActivityRow, {
        workspaceId: member.workspaceId,
        taskId: task.id,
        by: null,
        kind: 'event',
        text: 'người phụ trách đã rời không gian làm việc, task chưa có người nhận',
        tone: 'normal',
        at: now,
      });
    }
    effects.push(() => this.events.closeMemberStreams(memberId));
    if (left.changed) {
      effects.push(() =>
        this.events.publish(
          member.workspaceId,
          { type: 'rooms.changed' },
          { memberIds: left.audience },
        ),
      );
    }
    if (tasks.length > 0) {
      effects.push(() => this.events.publish(member.workspaceId, { type: 'tasks.changed' }));
    }
    return {
      revokedInvites: invites.length,
      revokedPairingCodes: codes.length,
      unassignedTasks: tasks.length,
    };
  }

  /** Stamps `onboarded_at` once; later calls leave it untouched. */
  async markOnboarded(workspaceId: string): Promise<void> {
    await this.workspaces.update(
      { id: workspaceId, onboardedAt: IsNull() },
      { onboardedAt: this.clock.now() },
    );
  }

  async findWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.findOne({ where: { id } });
  }

  private async uniqueSlug(manager: EntityManager, base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await manager.exists(Workspace, { where: { slug: candidate } }))) return candidate;
    }
  }
}

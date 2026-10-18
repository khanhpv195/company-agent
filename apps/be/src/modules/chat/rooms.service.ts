import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  BrowseRoom,
  Message,
  Room as RoomContract,
  RoomAgent,
  RoomMember,
  RoomMemberRole,
  RoomMembers,
} from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects, type AfterCommit } from '../../common/utils';
import { AuditService } from '../audit/audit.service';
import { Agent } from '../agents/entities/agent.entity';
import { EventsService } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { MAX_MESSAGE_LENGTH, MAX_ROOM_ADDS } from './chat.constants';
import { ChatService } from './chat.service';
import { MessageStore } from './message-store.service';
import type {
  AddRoomMembersDto,
  CreateRoomDto,
  CreateThreadDto,
  UpdateRoomDto,
} from './dto/rooms.dto';
import { Room } from './entities/room.entity';
import {
  assertRoomNameFree,
  dropRoomState,
  lockRooms,
  mapRoomNameConflict,
  promoteRoomOwner,
  retryOnDeadlock,
  roomMemberIds,
} from './room-access';

const OPEN_STATUSES = ['pending', 'offered', 'claimed', 'running'];

interface Access {
  room: Room;
  /** The caller's role in the room, null when they are not a member. */
  role: RoomMemberRole | null;
  admin: boolean;
}

const isAdminRole = (auth: AuthContext): boolean => auth.role === 'owner' || auth.role === 'admin';

/** Create, rename, delete, join/leave and membership of channels, plus creating threads. */
@Injectable()
export class RoomsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
    private readonly store: MessageStore,
    private readonly gateway: AgentGatewayService,
  ) {}

  // ---------- reads ----------

  /** Public channels (not inboxes) the caller has not joined. */
  async browse(auth: AuthContext): Promise<BrowseRoom[]> {
    const rows = returnedRows<{
      id: string;
      name: string;
      icon: BrowseRoom['icon'];
      members: string;
      agents: string;
    }>(
      await this.dataSource.query(
        `SELECT r.id, r.name, r.icon,
           (SELECT count(*) FROM room_members rm JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
             WHERE rm.room_id = r.id) AS members,
           (SELECT count(*) FROM room_members rm JOIN agents a ON a.id = rm.agent_id AND a.deleted_at IS NULL
             WHERE rm.room_id = r.id) AS agents
         FROM rooms r
         WHERE r.workspace_id = $1 AND r.kind = 'channel' AND r.is_private = false
           AND r.connection_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM room_members x WHERE x.room_id = r.id AND x.member_id = $2)
         ORDER BY r.created_at ASC, r.id ASC`,
        [auth.workspaceId, auth.memberId],
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      icon: row.icon,
      memberCount: Number(row.members),
      agentCount: Number(row.agents),
    }));
  }

  async members(auth: AuthContext, roomId: string): Promise<RoomMembers> {
    const manager = this.dataSource.manager;
    const access = await this.access(manager, auth, roomId);
    // Anybody who can see the room may list it; a public room's roster is not secret.
    this.assertChannel(access.room);
    return this.roster(manager, access.room.id);
  }

  // ---------- commands ----------

  async create(auth: AuthContext, dto: CreateRoomDto): Promise<RoomContract> {
    const roomId = await this.named(() =>
      transactionWithEffects(this.dataSource, async (manager, effects) => {
        await this.lock(manager, auth.workspaceId);
        await this.assertNameFree(manager, auth.workspaceId, dto.name, null);
        const parties = await this.resolveParties(manager, auth.workspaceId, dto);
        const now = this.clock.now();
        const room = await manager.save(
          manager.create(Room, {
            workspaceId: auth.workspaceId,
            kind: 'channel',
            name: dto.name,
            icon: 'users',
            isPrivate: dto.isPrivate ?? false,
            agentId: null,
            memberId: null,
            connectionId: null,
            createdAt: now,
          }),
        );
        const memberIds = [
          auth.memberId,
          ...parties.memberIds.filter((id) => id !== auth.memberId),
        ];
        await this.insertParties(manager, auth.workspaceId, room.id, memberIds, parties.agentIds, {
          ownerId: auth.memberId,
        });
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'room.created',
            targetType: 'room',
            targetId: room.id,
            meta: {
              name: room.name,
              isPrivate: room.isPrivate,
              members: memberIds.length,
              agents: parties.agentIds.length,
            },
            ip: auth.ip,
          },
          manager,
        );
        this.changed(effects, auth, room.isPrivate, memberIds);
        return room.id;
      }),
    );
    return this.require(auth, roomId);
  }

  async update(auth: AuthContext, roomId: string, dto: UpdateRoomDto): Promise<RoomContract> {
    await this.named(() =>
      transactionWithEffects(this.dataSource, async (manager, effects) => {
        await this.lock(manager, auth.workspaceId);
        const access = await this.access(manager, auth, roomId);
        this.assertEditable(access.room);
        this.assertManager(access);
        const { room } = access;
        // The default channel stays open to everybody who joins the workspace.
        if (room.isDefault && dto.isPrivate === true) {
          throw new BadRequestException({ message: 'chat.ROOM_IS_DEFAULT' });
        }
        const before = { name: room.name, isPrivate: room.isPrivate };
        if (dto.name !== undefined && dto.name.toLowerCase() !== room.name.toLowerCase()) {
          await this.assertNameFree(manager, auth.workspaceId, dto.name, room.id);
        }
        const changes: Partial<Pick<Room, 'name' | 'isPrivate'>> = {};
        if (dto.name !== undefined && dto.name !== room.name) changes.name = dto.name;
        if (dto.isPrivate !== undefined && dto.isPrivate !== room.isPrivate) {
          changes.isPrivate = dto.isPrivate;
        }
        if (!Object.keys(changes).length) return;
        await manager.update(Room, { id: room.id }, changes);
        if (changes.name !== undefined) {
          await this.audit.record(
            {
              workspaceId: auth.workspaceId,
              actorMemberId: auth.memberId,
              action: 'room.renamed',
              targetType: 'room',
              targetId: room.id,
              meta: { from: before.name, to: changes.name },
              ip: auth.ip,
            },
            manager,
          );
        }
        if (changes.isPrivate !== undefined) {
          await this.audit.record(
            {
              workspaceId: auth.workspaceId,
              actorMemberId: auth.memberId,
              action: 'room.updated',
              targetType: 'room',
              targetId: room.id,
              meta: { isPrivate: changes.isPrivate },
              ip: auth.ip,
            },
            manager,
          );
        }
        // A visibility change (either way) also moves the room in or out of every browse list.
        const stillPrivate = room.isPrivate && (changes.isPrivate ?? room.isPrivate);
        this.changed(effects, auth, stillPrivate, await roomMemberIds(manager, room.id));
      }),
    );
    return this.require(auth, roomId);
  }

  /** Its messages (threads included) and read cursors go with the room; open chat runs are cancelled. */
  async remove(auth: AuthContext, roomId: string): Promise<null> {
    // A runner reporting a result locks its assignment row, then its message: this transaction
    // locks (and cancels) the assignments first, then deletes the messages, in the same order.
    // A deadlock with a runner that still slips through rolls back whole and is retried once.
    await retryOnDeadlock(() =>
      transactionWithEffects(this.dataSource, async (manager, effects) => {
        await this.lock(manager, auth.workspaceId);
        const access = await this.access(manager, auth, roomId);
        this.assertEditable(access.room);
        this.assertManager(access);
        const { room } = access;
        if (room.isDefault) throw new BadRequestException({ message: 'chat.ROOM_IS_DEFAULT' });
        const audience = await roomMemberIds(manager, room.id);
        // Open runs end first; the messages go with the room (foreign key), their read marks
        // and the tasks linked to a thread of the room are cleaned up here.
        await this.cancelOpenReplies(manager, effects, room.id, null);
        await manager.query(
          `DELETE FROM thread_reads WHERE chat_id IN (SELECT id FROM messages WHERE room_id = $1)`,
          [room.id],
        );
        await manager.query(
          `UPDATE tasks SET chat_id = NULL
           WHERE workspace_id = $1 AND chat_id IN (SELECT id::text FROM messages WHERE room_id = $2)`,
          [auth.workspaceId, room.id],
        );
        await manager.delete(Room, { id: room.id });
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'room.deleted',
            targetType: 'room',
            targetId: room.id,
            meta: { name: room.name },
            ip: auth.ip,
          },
          manager,
        );
        this.changed(effects, auth, room.isPrivate, audience);
      }),
    );
    return null;
  }

  async join(auth: AuthContext, roomId: string): Promise<RoomContract> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lock(manager, auth.workspaceId);
      const access = await this.access(manager, auth, roomId);
      const { room } = access;
      this.assertChannel(room);
      if (room.connectionId) throw new BadRequestException({ message: 'chat.ROOM_NOT_JOINABLE' });
      // A private room is invisible to non-members: joining it looks like an unknown room.
      if (room.isPrivate && !access.role) throw this.notFound(roomId);
      if (access.role) return;
      await this.insertParties(manager, auth.workspaceId, room.id, [auth.memberId], []);
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'room.member_added',
          targetType: 'room',
          targetId: room.id,
          meta: { kind: 'member', id: auth.memberId, self: true },
          ip: auth.ip,
        },
        manager,
      );
      this.changed(effects, auth, room.isPrivate, await roomMemberIds(manager, room.id));
    });
    return this.require(auth, roomId);
  }

  /**
   * Leaving as the last owner promotes the oldest remaining human member. When no human is
   * left the room stays (its agents stay) without an owner: workspace owners/admins can still
   * manage or delete it, and a public one is still joinable.
   */
  async leave(auth: AuthContext, roomId: string): Promise<null> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lock(manager, auth.workspaceId);
      const access = await this.access(manager, auth, roomId);
      this.assertChannel(access.room);
      if (access.room.connectionId) {
        throw new BadRequestException({ message: 'chat.ROOM_NOT_LEAVABLE' });
      }
      if (!access.role) throw this.notFound(roomId);
      await this.removeParty(manager, effects, auth, access.room, 'member', auth.memberId);
    });
    return null;
  }

  async addMembers(
    auth: AuthContext,
    roomId: string,
    dto: AddRoomMembersDto,
  ): Promise<RoomMembers> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lock(manager, auth.workspaceId);
      const access = await this.access(manager, auth, roomId);
      this.assertEditable(access.room);
      // Public: any room member (or workspace owner/admin). Private: room owner or admin.
      const allowed = access.room.isPrivate
        ? access.admin || access.role === 'owner'
        : access.admin || access.role !== null;
      if (!allowed) throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
      const parties = await this.resolveParties(manager, auth.workspaceId, dto);
      if (!parties.memberIds.length && !parties.agentIds.length) {
        throw new BadRequestException({ message: 'chat.NOTHING_TO_ADD' });
      }
      const before = await roomMemberIds(manager, access.room.id);
      const added = await this.insertParties(
        manager,
        auth.workspaceId,
        access.room.id,
        parties.memberIds,
        parties.agentIds,
      );
      for (const item of added) {
        await this.audit.record(
          {
            workspaceId: auth.workspaceId,
            actorMemberId: auth.memberId,
            action: 'room.member_added',
            targetType: 'room',
            targetId: access.room.id,
            meta: item,
            ip: auth.ip,
          },
          manager,
        );
      }
      if (added.length) {
        const after = await roomMemberIds(manager, access.room.id);
        this.changed(effects, auth, access.room.isPrivate, [...new Set([...before, ...after])]);
      }
    });
    return this.roster(this.dataSource.manager, roomId);
  }

  async removeMember(
    auth: AuthContext,
    roomId: string,
    kind: string,
    targetId: string,
  ): Promise<RoomMembers> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      await this.lock(manager, auth.workspaceId);
      const access = await this.access(manager, auth, roomId);
      this.assertEditable(access.room);
      if (kind !== 'member' && kind !== 'agent') {
        throw new BadRequestException({ message: 'chat.INVALID_MEMBER_KIND' });
      }
      const self = kind === 'member' && targetId === auth.memberId;
      if (!self && !access.admin && access.role !== 'owner') {
        throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
      }
      if (self && !access.role && !access.admin) throw this.notFound(roomId);
      await this.removeParty(manager, effects, auth, access.room, kind, targetId);
    });
    // A member who removed themselves may no longer see the room.
    const manager = this.dataSource.manager;
    const access = await this.access(manager, auth, roomId).catch(() => null);
    return access ? this.roster(manager, roomId) : { members: [], agents: [] };
  }

  /**
   * Compatibility wrapper over the send path: posts a root message of the channel with
   * `threadTitle` = the name (its text is `message`, or the name when none is given) and
   * returns that root message. Agents mentioned in `message` answer under it.
   */
  async createThread(auth: AuthContext, roomId: string, dto: CreateThreadDto): Promise<Message> {
    const text = dto.message?.trim();
    if (text && text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ message: 'chat.MESSAGE_TOO_LONG' });
    }
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      // The rooms lock: a concurrent room delete is seen as "not found", never a raw FK error.
      await this.lock(manager, auth.workspaceId);
      const access = await this.access(manager, auth, roomId);
      this.assertEditable(access.room);
      if (!access.role) throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
      return this.store.send(
        auth,
        access.room.id,
        // The name stands in for a missing text and is never searched for @mentions.
        { markdown: text || dto.name, threadTitle: dto.name, mentionsFrom: text ?? '' },
        { manager, effects },
      );
    });
  }

  // ---------- internals ----------

  private async require(auth: AuthContext, roomId: string): Promise<RoomContract> {
    const room = await this.chat.roomOf(auth, roomId);
    if (!room) throw this.notFound(roomId);
    return room;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({ message: 'chat.ROOM_NOT_FOUND', args: { id } });
  }

  /** Serializes room commands per workspace (name uniqueness, the last-owner rule). */
  private async lock(manager: EntityManager, workspaceId: string): Promise<void> {
    await lockRooms(manager, workspaceId);
  }

  /** A unique violation on the channel name (a race past `assertNameFree`) is a 409, not a 500. */
  private async named<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      return mapRoomNameConflict(error);
    }
  }

  /**
   * `rooms.changed` after the commit. A public room is listed for the whole workspace (browse
   * and member counts), so everybody is told (`isPrivate` false); a private one only reaches
   * its members, plus the acting member (a workspace admin managing a room they are not in).
   */
  private changed(
    effects: AfterCommit[],
    auth: AuthContext,
    isPrivate: boolean,
    memberIds: string[],
  ): void {
    const audience = isPrivate ? [...new Set([...memberIds, auth.memberId])] : undefined;
    effects.push(() => this.chat.publishRoomsChanged(auth.workspaceId, audience));
  }

  /**
   * Cancels the open chat runs of a room (optionally of one agent only). The
   * assignments are locked first, in id order, like a runner reporting its result does.
   */
  private async cancelOpenReplies(
    manager: EntityManager,
    effects: AfterCommit[],
    roomId: string,
    agentId: string | null,
  ): Promise<void> {
    const open = returnedRows<{ id: string }>(
      await manager.query(
        `SELECT a.id FROM assignments a
         WHERE a.status = ANY($2::text[]) AND ($3::uuid IS NULL OR a.agent_id = $3)
           AND a.id IN (SELECT m.assignment_id FROM messages m WHERE m.room_id = $1)
         ORDER BY a.id FOR UPDATE`,
        [roomId, OPEN_STATUSES, agentId],
      ),
    );
    for (const { id } of open) {
      try {
        await this.gateway.cancel(id, { manager, effects });
      } catch (error) {
        // Already ended by a runner in the meantime: nothing left to cancel.
        if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) {
          throw error;
        }
      }
    }
  }

  /**
   * The room as the caller may touch it: any channel of the workspace they can see (public,
   * an inbox, one they belong to), or a private one as workspace owner/admin. DMs of others
   * and everything else is "not found".
   */
  private async access(manager: EntityManager, auth: AuthContext, id: string): Promise<Access> {
    if (!isUUID(id)) throw this.notFound(id);
    const room = await manager.findOne(Room, { where: { id, workspaceId: auth.workspaceId } });
    if (!room) throw this.notFound(id);
    if (room.kind === 'dm' && room.memberId !== auth.memberId) throw this.notFound(id);
    const rows = returnedRows<{ role: RoomMemberRole }>(
      await manager.query(`SELECT role FROM room_members WHERE room_id = $1 AND member_id = $2`, [
        id,
        auth.memberId,
      ]),
    );
    const role = rows[0]?.role ?? null;
    const admin = isAdminRole(auth);
    if (room.kind === 'channel' && room.isPrivate && !role && !admin) throw this.notFound(id);
    return { room, role, admin };
  }

  private assertChannel(room: Room): void {
    if (room.kind !== 'channel')
      throw new BadRequestException({ message: 'chat.ROOM_NOT_EDITABLE' });
  }

  /** Channels only, and not the inbox a connection owns. */
  private assertEditable(room: Room): void {
    this.assertChannel(room);
    if (room.connectionId) throw new BadRequestException({ message: 'chat.ROOM_NOT_EDITABLE' });
  }

  private assertManager(access: Access): void {
    if (!access.admin && access.role !== 'owner') {
      throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
    }
  }

  private assertNameFree(
    manager: EntityManager,
    workspaceId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    return assertRoomNameFree(manager, workspaceId, name, exceptId);
  }

  /** Dedupes and checks the ids: every one must be a live member / agent of the workspace. */
  private async resolveParties(
    manager: EntityManager,
    workspaceId: string,
    input: { memberIds?: string[]; agentIds?: string[] },
  ): Promise<{ memberIds: string[]; agentIds: string[] }> {
    const memberIds = [...new Set(input.memberIds ?? [])];
    const agentIds = [...new Set(input.agentIds ?? [])];
    if (memberIds.length + agentIds.length > MAX_ROOM_ADDS) {
      throw new BadRequestException({ message: 'chat.TOO_MANY_MEMBERS' });
    }
    if (memberIds.length) {
      const valid = memberIds.every((id) => isUUID(id));
      const found = valid
        ? returnedRows<{ id: string }>(
            await manager.query(
              `SELECT id FROM members WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND removed_at IS NULL`,
              [workspaceId, memberIds],
            ),
          )
        : [];
      if (found.length !== memberIds.length) {
        throw new BadRequestException({ message: 'chat.UNKNOWN_MEMBER' });
      }
    }
    if (agentIds.length) {
      const valid = agentIds.every((id) => isUUID(id));
      const found = valid
        ? await manager
            .createQueryBuilder(Agent, 'a')
            .where('a.workspace_id = :workspaceId AND a.id IN (:...agentIds)', {
              workspaceId,
              agentIds,
            })
            .getCount()
        : 0;
      if (found !== agentIds.length) {
        throw new BadRequestException({ message: 'chat.UNKNOWN_AGENT' });
      }
    }
    return { memberIds, agentIds };
  }

  /** Inserts the missing memberships; returns what was actually added. */
  private async insertParties(
    manager: EntityManager,
    workspaceId: string,
    roomId: string,
    memberIds: string[],
    agentIds: string[],
    options: { ownerId?: string } = {},
  ): Promise<Array<{ kind: 'member' | 'agent'; id: string }>> {
    const added: Array<{ kind: 'member' | 'agent'; id: string }> = [];
    for (const id of memberIds) {
      const rows = returnedRows<{ id: string }>(
        await manager.query(
          `INSERT INTO room_members (workspace_id, room_id, member_id, role, created_at)
           VALUES ($1, $2, $3, $4, clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id`,
          [workspaceId, roomId, id, id === options.ownerId ? 'owner' : 'member'],
        ),
      );
      if (rows.length) added.push({ kind: 'member', id });
    }
    for (const id of agentIds) {
      const rows = returnedRows<{ id: string }>(
        await manager.query(
          `INSERT INTO room_members (workspace_id, room_id, agent_id, role, created_at)
           VALUES ($1, $2, $3, 'member', clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id`,
          [workspaceId, roomId, id],
        ),
      );
      if (rows.length) added.push({ kind: 'agent', id });
    }
    return added;
  }

  /** Removes one membership, keeps the owner rule, audits, and tells everyone affected. */
  private async removeParty(
    manager: EntityManager,
    effects: AfterCommit[],
    auth: AuthContext,
    room: Room,
    kind: 'member' | 'agent' | string,
    targetId: string,
  ): Promise<void> {
    if (!isUUID(targetId)) {
      throw new NotFoundException({ message: 'chat.ROOM_MEMBER_NOT_FOUND' });
    }
    const before = await roomMemberIds(manager, room.id);
    const column = kind === 'agent' ? 'agent_id' : 'member_id';
    const removed = returnedRows<{ role: RoomMemberRole }>(
      await manager.query(
        `DELETE FROM room_members WHERE room_id = $1 AND ${column} = $2 RETURNING role`,
        [room.id, targetId],
      ),
    );
    if (!removed.length) throw new NotFoundException({ message: 'chat.ROOM_MEMBER_NOT_FOUND' });
    if (kind === 'member') await dropRoomState(manager, targetId, room.id);
    if (kind === 'member' && removed[0].role === 'owner') {
      // The oldest remaining human member takes over; none left = an ownerless room.
      await promoteRoomOwner(manager, room.id);
    }
    if (kind === 'agent') {
      // An agent that left the room stops answering in it: its open replies in the room end.
      await this.cancelOpenReplies(manager, effects, room.id, targetId);
    }
    await this.audit.record(
      {
        workspaceId: auth.workspaceId,
        actorMemberId: auth.memberId,
        action: 'room.member_removed',
        targetType: 'room',
        targetId: room.id,
        meta: { kind, id: targetId, self: kind === 'member' && targetId === auth.memberId },
        ip: auth.ip,
      },
      manager,
    );
    // The removed member is told too (their sidebar drops the room).
    this.changed(effects, auth, room.isPrivate, before);
  }

  private async roster(manager: EntityManager, roomId: string): Promise<RoomMembers> {
    const members = returnedRows<{
      member_id: string;
      name: string;
      color: string | null;
      role: RoomMemberRole;
      created_at: Date;
    }>(
      await manager.query(
        `SELECT rm.member_id, m.name, m.color, rm.role, rm.created_at
         FROM room_members rm JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
         WHERE rm.room_id = $1
         ORDER BY (rm.role = 'owner') DESC, rm.created_at ASC, rm.id ASC`,
        [roomId],
      ),
    );
    const agents = returnedRows<{
      agent_id: string;
      name: string;
      avatar: number;
      created_at: Date;
    }>(
      await manager.query(
        `SELECT rm.agent_id, a.name, a.avatar, rm.created_at
         FROM room_members rm JOIN agents a ON a.id = rm.agent_id AND a.deleted_at IS NULL
         WHERE rm.room_id = $1
         ORDER BY rm.created_at ASC, rm.id ASC`,
        [roomId],
      ),
    );
    return {
      members: members.map((row): RoomMember => ({
        memberId: row.member_id,
        name: row.name,
        color: row.color,
        role: row.role,
        joinedAt: new Date(row.created_at).toISOString(),
      })),
      agents: agents.map((row): RoomAgent => ({
        agentId: row.agent_id,
        name: row.name,
        avatar: Number(row.avatar),
        joinedAt: new Date(row.created_at).toISOString(),
      })),
    };
  }
}

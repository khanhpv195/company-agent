import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Chat, Message, Room as RoomContract, Thread as ThreadContract } from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ClockService } from '../../common/clock';
import { agentConfig } from '../../config';
import { returnedRows, transactionWithEffects, type AfterCommit } from '../../common/utils';
import type { AuthContext } from '../../common/types';
import { Agent } from '../agents/entities/agent.entity';
import { EventsService } from '../events';
import { ASSIGNMENT_ENDED_EVENT, type AssignmentEndedPayload } from '../events/events.service';
import { Assignment } from '../gateway/entities/assignment.entity';
import { AgentActivity } from '../agents/entities/agent-activity.entity';
import {
  CHAT_RUN_ENDED_EVENT,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PAGE_LIMIT,
  type ChatRunEndedPayload,
} from './chat.constants';
import { threadNameOf, toRoom, toThread, type LastMessage } from './chat.mapper';
import { previewOf } from './chat.util';
import { ensureDmRoom } from './dm-room';
import { roomMemberIds } from './room-access';
import { MessageStore, type RoomScope } from './message-store.service';
import type { SendMessageDto } from './dto/chat.dto';
import { ChatMessage } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';

/** Why a reply that was in flight when the server stopped ends as failed. */
const RESTART_ERROR = 'Server restarted before the reply finished';
const STALE_STATUSES = ['pending', 'offered', 'claimed', 'running'];

/**
 * A chat of the legacy routes: a DM room (its main timeline; `id` = the room id) or a thread
 * (`id` = the root message id, in any room). A DM of another member and anything of another
 * workspace resolve to nothing.
 */
export interface ResolvedChat extends RoomScope {
  id: string;
  kind: 'dm' | 'thread';
  /** The thread's root message; null for a DM main timeline. */
  root: ChatMessage | null;
}

/** Everything a runner needs to work on one chat reply. */
export interface ReplyContext {
  assignment: Assignment;
  message: ChatMessage;
  agent: Agent;
  chat: ResolvedChat;
  /** The only members who may see this chat's events; undefined = the whole workspace. */
  memberIds: string[] | undefined;
  /**
   * Where the request came from, for the agent's activity log (a workspace-visible surface):
   * "DM", "# room › thread", or a neutral "private channel" for a private room's thread.
   */
  where: string;
}

/** Neutral `where` of an agent activity for a private channel (the real name stays private). */
export const PRIVATE_CHANNEL_WHERE = 'Kênh riêng';

@Injectable()
export class ChatService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly store: MessageStore,
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
  ) {}

  /**
   * A reply streams from memory inside one process, so one cut off by a restart can never
   * finish. Mark those assignments expired and their messages failed instead of leaving
   * them streaming forever. Note: two dev instances on one DB with the simulator on will
   * fail each other's in-flight replies on boot.
   */
  async onApplicationBootstrap(): Promise<void> {
    // Only the simulator streams replies from memory; with real daemons nothing is cut off here.
    if (!this.config.simulator) return;
    try {
      const failed = await this.failStaleReplies();
      if (failed) this.logger.warn(`Marked ${failed} interrupted chat repl(ies) as failed`);
    } catch (error) {
      this.logger.error(
        'Cleaning up interrupted chat replies failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * One statement: expire the open chat assignments of simulated computers (real daemons keep
   * their own) and fail their streaming messages.
   */
  async failStaleReplies(): Promise<number> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `WITH stale AS (
           UPDATE assignments
           SET status = 'expired', error = $1, ended_at = $2, lease_expires_at = NULL, updated_at = $2
           WHERE source_kind = 'chat' AND status = ANY($3::text[])
             AND computer_id IN (SELECT id FROM computers WHERE simulated = true)
           RETURNING id
         )
         UPDATE messages m SET status = 'failed'
         FROM stale WHERE m.assignment_id = stale.id AND m.status = 'streaming' AND m.deleted_at IS NULL
         RETURNING m.id`,
        [RESTART_ERROR, this.clock.now(), STALE_STATUSES],
      ),
    );
    return rows.length;
  }

  // ---------- reads ----------

  /**
   * The caller's DMs, the channels they belong to (public or private) and the connection
   * inboxes (visible to every member), with derived previews and unread.
   */
  async listRooms(auth: AuthContext): Promise<RoomContract[]> {
    return this.assembleRooms(auth, undefined);
  }

  /** One room as `GET /rooms` shows it; null when the caller cannot see it. */
  async roomOf(auth: AuthContext, roomId: string): Promise<RoomContract | null> {
    if (!isUUID(roomId)) return null;
    return (await this.assembleRooms(auth, roomId))[0] ?? null;
  }

  private async assembleRooms(auth: AuthContext, onlyRoomId: string | undefined) {
    const { workspaceId, memberId } = auth;
    const manager = this.dataSource.manager;
    const mine = returnedRows<{ room_id: string; role: 'owner' | 'member' }>(
      await manager.query(
        `SELECT room_id, role FROM room_members WHERE workspace_id = $1 AND member_id = $2`,
        [workspaceId, memberId],
      ),
    );
    const roleByRoom = new Map(mine.map((row) => [row.room_id, row.role]));
    const rooms = (
      await manager.find(Room, {
        where: [
          { workspaceId, kind: 'channel', id: In([...roleByRoom.keys()]) },
          { workspaceId, kind: 'channel', connectionId: Not(IsNull()) },
          { workspaceId, kind: 'dm', memberId },
          // A workspace owner/admin managing one room may see it without being a member.
          ...(onlyRoomId && (auth.role === 'owner' || auth.role === 'admin')
            ? [{ workspaceId, kind: 'channel' as const, id: onlyRoomId }]
            : []),
        ],
        // The join skips soft-deleted agents: a deleted agent's DM is hidden.
        relations: { agent: true },
      })
    )
      .filter((room) => !onlyRoomId || room.id === onlyRoomId)
      .filter((room) => room.kind === 'channel' || room.agent)
      // DMs first (newest first, like the mock's unshift), then channels in creation order.
      .sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'dm'
            ? -1
            : 1
          : a.kind === 'dm'
            ? b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
            : a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      );
    const counts = new Map<string, { members: number; agents: number }>();
    const countIds = rooms.filter((room) => room.kind === 'channel').map((room) => room.id);
    if (countIds.length) {
      for (const row of returnedRows<{ room_id: string; members: string; agents: string }>(
        await manager.query(
          `SELECT rm.room_id,
                  count(m.id) AS members,
                  count(a.id) AS agents
           FROM room_members rm
           LEFT JOIN members m ON m.id = rm.member_id AND m.removed_at IS NULL
           LEFT JOIN agents a ON a.id = rm.agent_id AND a.deleted_at IS NULL
           WHERE rm.room_id = ANY($1::uuid[])
           GROUP BY rm.room_id`,
          [countIds],
        ),
      )) {
        counts.set(row.room_id, { members: Number(row.members), agents: Number(row.agents) });
      }
    }
    const channelIds = countIds;
    // The legacy sidebar's threads: roots of a channel with a title or replies (id = root id).
    const roots = channelIds.length
      ? await manager
          .createQueryBuilder(ChatMessage, 'm')
          .where('m.workspace_id = :workspaceId AND m.room_id IN (:...channelIds)', {
            workspaceId,
            channelIds,
          })
          .andWhere('m.parent_id IS NULL AND m.deleted_at IS NULL')
          .andWhere('(m.thread_title IS NOT NULL OR m.reply_count > 0)')
          .orderBy('m.seq', 'ASC')
          .addOrderBy('m.createdAt', 'ASC')
          .addOrderBy('m.id', 'ASC')
          .getMany()
      : [];
    const connectionByRoom = new Map(rooms.map((room) => [room.id, room.connectionId]));

    const dmIds = rooms.filter((room) => room.kind === 'dm').map((room) => room.id);
    const rootIds = roots.map((root) => root.id);
    const lastByChat = new Map<string, LastMessage>();
    const unreadByChat = new Map<string, number>();
    if (dmIds.length) {
      const lasts = returnedRows<{ room_id: string; markdown: string; created_at: Date }>(
        await manager.query(
          `SELECT DISTINCT ON (room_id) room_id, markdown, created_at
           FROM messages
           WHERE workspace_id = $1 AND room_id = ANY($2::uuid[])
             AND parent_id IS NULL AND deleted_at IS NULL AND NOT system_root
           ORDER BY room_id, seq DESC`,
          [workspaceId, dmIds],
        ),
      );
      for (const row of lasts) {
        lastByChat.set(row.room_id, { markdown: row.markdown, createdAt: row.created_at });
      }
    }
    if (rootIds.length) {
      const lasts = returnedRows<{ chat_id: string; markdown: string; created_at: Date }>(
        await manager.query(
          `SELECT DISTINCT ON (chat_id) chat_id, markdown, created_at
           FROM (
             SELECT coalesce(parent_id, id) AS chat_id, markdown, created_at, seq, parent_id
             FROM messages
             WHERE workspace_id = $1 AND deleted_at IS NULL AND NOT system_root
               AND (id = ANY($2::uuid[]) OR parent_id = ANY($2::uuid[]))
           ) t
           ORDER BY chat_id, seq DESC, (parent_id IS NOT NULL) DESC`,
          [workspaceId, rootIds],
        ),
      );
      for (const row of lasts) {
        lastByChat.set(row.chat_id, { markdown: row.markdown, createdAt: row.created_at });
      }
      const unread = returnedRows<{ chat_id: string; unread: string }>(
        await manager.query(
          `SELECT t.chat_id, count(*) AS unread
           FROM (
             SELECT coalesce(parent_id, id) AS chat_id, created_at, author_kind, author_member_id
             FROM messages
             WHERE workspace_id = $1 AND deleted_at IS NULL AND NOT system_root
               AND (id = ANY($2::uuid[]) OR parent_id = ANY($2::uuid[]))
           ) t
           LEFT JOIN thread_reads r ON r.chat_id = t.chat_id AND r.member_id = $3
           WHERE t.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
             AND NOT (t.author_kind = 'human' AND t.author_member_id = $3)
           GROUP BY t.chat_id`,
          [workspaceId, rootIds, memberId],
        ),
      );
      for (const row of unread) unreadByChat.set(row.chat_id, Number(row.unread));
    }

    const threadsByRoom = new Map<string, ThreadContract[]>();
    for (const root of roots) {
      const list = threadsByRoom.get(root.roomId) ?? [];
      list.push(
        toThread(
          root,
          lastByChat.get(root.id),
          unreadByChat.get(root.id) ?? 0,
          previewOf,
          connectionByRoom.get(root.roomId) ?? null,
        ),
      );
      threadsByRoom.set(root.roomId, list);
    }
    return rooms.map((room) => ({
      ...toRoom(
        room,
        threadsByRoom.get(room.id) ?? [],
        room.kind === 'dm' ? lastByChat.get(room.id) : undefined,
        previewOf,
      ),
      ...(room.kind === 'channel'
        ? {
            memberCount: counts.get(room.id)?.members ?? 0,
            agentCount: counts.get(room.id)?.agents ?? 0,
            isDefault: room.isDefault,
            myRole: roleByRoom.get(room.id) ?? null,
          }
        : {}),
    }));
  }

  async getChat(auth: AuthContext, id: string): Promise<Chat> {
    const manager = this.dataSource.manager;
    const chat = await this.requireChat(manager, auth, id);
    return this.toChat(manager, chat);
  }

  /**
   * Legacy chat messages, oldest first, the latest 200 (deleted ones left out): a DM's main
   * timeline, or a thread's root followed by its replies.
   */
  async listMessages(auth: AuthContext, id: string): Promise<Message[]> {
    const manager = this.dataSource.manager;
    const chat = await this.requireChat(manager, auth, id);
    const qb = manager
      .createQueryBuilder(ChatMessage, 'm')
      .leftJoinAndSelect('m.assignment', 'a')
      .where('m.workspace_id = :workspaceId AND m.deleted_at IS NULL', {
        workspaceId: auth.workspaceId,
      });
    if (chat.root) {
      qb.andWhere('(m.id = :rootId OR m.parent_id = :rootId)', { rootId: chat.root.id });
    } else {
      qb.andWhere('m.room_id = :roomId AND m.parent_id IS NULL', { roomId: chat.room.id });
    }
    // A converted thread's synthetic root shares the seq of its first reply: the root comes first.
    const rows = await qb
      .orderBy('m.seq', 'DESC')
      .addOrderBy('(m.parent_id IS NOT NULL)', 'DESC')
      .limit(MESSAGES_PAGE_LIMIT)
      .getMany();
    return this.store.hydrate(manager, rows.reverse());
  }

  // ---------- commands ----------

  /**
   * Legacy send: the chat id is a DM room (main timeline) or a thread root message (a reply).
   * Everything else (agent wake-up, placement of the reply) is `MessageStore.send`.
   */
  async sendMessage(
    auth: AuthContext,
    chatId: string,
    dto: SendMessageDto,
    /** Join the caller's transaction (its effects fire after its commit) instead of opening one. */
    tx?: { manager: EntityManager; effects: AfterCommit[] },
  ): Promise<Message> {
    if (!dto.markdown?.trim()) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });
    const chat = await this.requireChat(tx?.manager ?? this.dataSource.manager, auth, chatId);
    return this.store.send(
      auth,
      chat.room.id,
      { markdown: dto.markdown, agentId: dto.agentId, parentId: chat.root?.id ?? null },
      tx,
    );
  }

  /** Marks the chat read for the caller. Chats the caller cannot see are a silent no-op. */
  async markRead(auth: AuthContext, id: string): Promise<null> {
    const manager = this.dataSource.manager;
    const chat = await this.findChat(manager, auth, id);
    if (!chat) return null;
    await manager.query(
      `INSERT INTO thread_reads (member_id, chat_id, last_read_at) VALUES ($1, $2, $3)
       ON CONFLICT (member_id, chat_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
      [auth.memberId, chat.id, this.clock.now()],
    );
    this.events.publish(
      auth.workspaceId,
      { type: 'rooms.changed' },
      { memberIds: [auth.memberId] },
    );
    return null;
  }

  /** Gets or creates the caller's DM with an agent of the workspace. */
  async ensureDm(auth: AuthContext, agentId: string): Promise<{ chatId: string }> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const agent = isUUID(agentId)
        ? await manager.findOne(Agent, { where: { id: agentId, workspaceId: auth.workspaceId } })
        : null;
      if (!agent) throw new NotFoundException({ message: 'chat.AGENT_NOT_FOUND' });
      const dm = await ensureDmRoom(manager, {
        workspaceId: auth.workspaceId,
        memberId: auth.memberId,
        agent,
        now: this.clock.now(),
      });
      if (dm.created) {
        effects.push(() => this.publishRoomsChanged(auth.workspaceId, [auth.memberId]));
      }
      return { chatId: dm.id };
    });
  }

  /** Only the draft state changes (nothing leaves the product yet). */
  async sendDraft(auth: AuthContext, messageId: string): Promise<Message> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const row = isUUID(messageId)
        ? await manager.findOne(ChatMessage, {
            where: { id: messageId, workspaceId: auth.workspaceId },
            relations: { assignment: true },
          })
        : null;
      const room = row
        ? await manager.findOne(Room, { where: { id: row.roomId }, relations: { agent: true } })
        : null;
      const scope = room ? await this.store.scopeOf(manager, room, auth.memberId) : null;
      if (!row || !row.draft || row.deletedAt || !scope)
        throw new NotFoundException({ message: 'chat.DRAFT_NOT_FOUND' });
      if (row.draft.state !== 'sent') {
        row.draft = { ...row.draft, state: 'sent' };
        await manager.update(ChatMessage, { id: row.id }, { draft: row.draft });
      }
      const message = (await this.store.hydrate(manager, [row]))[0];
      effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
      return message;
    });
  }

  /**
   * A message an agent posts on its own (the `post_message` tool), visible exactly like the
   * requester sees the chat: a DM of another member or a foreign chat is "not found". No reply
   * is requested, so agents never trigger each other. Address it with the legacy `chatId` (a DM
   * room or a thread root id) or with `{ roomId, parentId? }` (parentId = a message of the room).
   */
  async postAgentMessage(
    auth: AuthContext,
    agentId: string,
    target: string | { roomId: string; parentId?: string | null },
    markdown: string,
  ): Promise<Message> {
    const text = markdown?.trim();
    if (!text) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ message: 'chat.MESSAGE_TOO_LONG' });
    }
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      let scope: RoomScope;
      let rootId: string | null;
      if (typeof target === 'string') {
        const chat = await this.requireChat(manager, auth, target);
        scope = chat;
        rootId = chat.root?.id ?? null;
      } else {
        scope = await this.store.resolveRoom(manager, auth, target.roomId);
        rootId = target.parentId
          ? (await this.store.resolveRoot(manager, scope.room, target.parentId)).id
          : null;
      }
      if (scope.room.kind === 'dm' && scope.room.agentId !== agentId) {
        throw new BadRequestException({ message: 'chat.UNKNOWN_AGENT' });
      }
      if (scope.roomAgentIds && !scope.roomAgentIds.includes(agentId)) {
        throw new BadRequestException({ message: 'chat.AGENT_NOT_IN_ROOM' });
      }
      return this.store.insertAgentMessage(manager, effects, auth, scope, rootId, agentId, text);
    });
  }

  /**
   * The chat id (DM room id or thread root id) of a chat reply assignment, or null. This is the
   * daemon's session key, so it stays the old thread id for converted threads.
   */
  async chatIdOfReply(assignmentId: string): Promise<string | null> {
    const rows = returnedRows<{
      id: string;
      parent_id: string | null;
      room_id: string;
      kind: string;
    }>(
      await this.dataSource.query(
        `SELECT m.id, m.parent_id, m.room_id, r.kind
         FROM messages m JOIN rooms r ON r.id = m.room_id
         WHERE m.assignment_id = $1 LIMIT 1`,
        [assignmentId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return row.parent_id ?? (row.kind === 'dm' ? row.room_id : row.id);
  }

  /** `{ roomId, parentId }` of a chat reply assignment (parentId = the thread root, null in a DM main timeline). */
  async placeOfReply(
    assignmentId: string,
  ): Promise<{ roomId: string; parentId: string | null } | null> {
    const rows = returnedRows<{ room_id: string; parent_id: string | null }>(
      await this.dataSource.query(
        `SELECT room_id, parent_id FROM messages WHERE assignment_id = $1 LIMIT 1`,
        [assignmentId],
      ),
    );
    return rows[0] ? { roomId: rows[0].room_id, parentId: rows[0].parent_id } : null;
  }

  // ---------- used by the runners ----------

  /**
   * Activity log entry (inside the run's final transaction), then after commit the domain event
   * Phase 6 listens to and the "something changed" pings. Shared by the simulator and daemons.
   */
  async recordRun(
    manager: EntityManager,
    effects: Array<() => void>,
    ctx: ReplyContext,
    text: string,
    ok: boolean,
    durationSec: number,
  ): Promise<void> {
    const workspaceId = ctx.assignment.workspaceId;
    // A DM is private to its member and a private channel to its members: the activity log
    // and the workspace feed get a neutral line only (no text, no room or thread name).
    const dm = ctx.chat.room.kind === 'dm';
    const privateRoom = !dm && ctx.chat.room.isPrivate;
    const preview = dm || privateRoom ? '' : previewOf(text);
    await manager.getRepository(AgentActivity).insert({
      workspaceId,
      agentId: ctx.agent.id,
      location: ctx.where,
      request: dm ? 'Tin nhắn riêng (DM)' : privateRoom ? 'Tin nhắn trong kênh riêng' : preview,
      status: ok ? 'completed' : 'failed',
      at: this.clock.now(),
    });
    effects.push(() => {
      const payload: ChatRunEndedPayload = {
        workspaceId,
        agentId: ctx.agent.id,
        ok,
        durationSec,
        preview,
        dm,
        privateRoom,
      };
      this.emitter.emit(CHAT_RUN_ENDED_EVENT, payload);
      this.events.publish(workspaceId, { type: 'agents.changed' });
      this.publishRoomsChanged(workspaceId, ctx.memberIds);
    });
  }

  /** The state of one chat reply, or null when it is gone or not a chat assignment. */
  async replyContext(assignmentId: string): Promise<ReplyContext | null> {
    const manager = this.dataSource.manager;
    const assignment = await manager.findOneBy(Assignment, { id: assignmentId });
    if (!assignment || assignment.sourceKind !== 'chat') return null;
    const message = await manager.findOne(ChatMessage, {
      where: { id: assignment.sourceId },
      relations: { assignment: true },
    });
    // A deleted agent's cancelled reply must still resolve (to publish its failed message).
    const agent = await manager.findOne(Agent, {
      where: { id: assignment.agentId },
      relations: { computer: true },
      withDeleted: true,
    });
    if (!message || !agent) return null;
    const chat = await this.chatOfMessage(manager, message);
    if (!chat) return null;
    return {
      assignment,
      message,
      agent,
      chat,
      memberIds: chat.audience,
      where:
        chat.room.kind === 'dm'
          ? 'DM'
          : chat.room.isPrivate
            ? PRIVATE_CHANNEL_WHERE
            : `# ${chat.room.name}${chat.root ? ` › ${threadNameOf(chat.root, previewOf)}` : ''}`,
    };
  }

  /**
   * Who may see a room's events right now (a DM's member, a channel's members, undefined = the
   * whole workspace for an inbox). Streams call this on every publish so a member removed from
   * a private room mid-reply stops receiving chunks. `null` = the room is gone.
   */
  async currentAudience(roomId: string): Promise<{ audience: string[] | undefined } | null> {
    if (!isUUID(roomId)) return null;
    const manager = this.dataSource.manager;
    const rows = returnedRows<{
      kind: 'channel' | 'dm';
      member_id: string | null;
      connection_id: string | null;
    }>(
      await manager.query(`SELECT kind, member_id, connection_id FROM rooms WHERE id = $1`, [
        roomId,
      ]),
    );
    const row = rows[0];
    if (!row) return null;
    if (row.kind === 'dm') return { audience: row.member_id ? [row.member_id] : undefined };
    if (row.connection_id) return { audience: undefined };
    return { audience: await roomMemberIds(manager, roomId) };
  }

  /** The message as clients see it, with its assignment's current state. */
  loadMessage(id: string, manager: EntityManager = this.dataSource.manager): Promise<Message> {
    return this.store.loadMessage(id, manager);
  }

  publishMessage(
    workspaceId: string,
    message: Message,
    memberIds: readonly string[] | undefined,
  ): void {
    this.store.publishMessage(workspaceId, message, memberIds);
  }

  publishRoomsChanged(workspaceId: string, memberIds: readonly string[] | undefined): void {
    this.store.publishRoomsChanged(workspaceId, memberIds);
  }

  /**
   * A chat run that ended without the runner finishing its message (lease expiry, an operator
   * cancelling, a daemon reporting failure): the message must not stay "streaming".
   */
  @OnEvent(ASSIGNMENT_ENDED_EVENT)
  async onAssignmentEnded(payload: AssignmentEndedPayload): Promise<void> {
    if (payload.sourceKind !== 'chat' || payload.status === 'completed') return;
    try {
      const rows = returnedRows<{ id: string }>(
        await this.dataSource.query(
          `UPDATE messages SET status = 'failed'
           WHERE assignment_id = $1 AND status = 'streaming' AND deleted_at IS NULL RETURNING id`,
          [payload.assignmentId],
        ),
      );
      if (!rows.length) return;
      const context = await this.replyContext(payload.assignmentId);
      if (!context) return;
      this.publishMessage(
        payload.workspaceId,
        await this.loadMessage(context.message.id),
        context.memberIds,
      );
    } catch (error) {
      this.logger.error(
        `Failing the message of assignment ${payload.assignmentId} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ---------- internals ----------

  private async toChat(manager: EntityManager, chat: ResolvedChat): Promise<Chat> {
    const agents = await manager.find(Agent, {
      where: { workspaceId: chat.room.workspaceId },
      relations: { computer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const agentIds = this.store.wakeable(chat, agents).map((agent) => agent.id);
    if (chat.root) {
      return {
        id: chat.id,
        kind: 'thread',
        title: threadNameOf(chat.root, previewOf),
        subtitle: chat.room.kind === 'dm' ? null : `# ${chat.room.name}`,
        agentIds,
      };
    }
    const partner = agents.find((agent) => agent.id === chat.room.agentId);
    return {
      id: chat.id,
      kind: 'dm',
      title: partner?.name ?? chat.room.name,
      subtitle: null,
      agentIds,
    };
  }

  private async requireChat(
    manager: EntityManager,
    auth: AuthContext,
    id: string,
  ): Promise<ResolvedChat> {
    const chat = await this.findChat(manager, auth, id);
    if (!chat) throw new NotFoundException({ message: 'chat.NOT_FOUND', args: { id } });
    return chat;
  }

  /**
   * A thread root message id first, then a DM room id. A DM of another member, a channel the
   * caller is not in and anything of another workspace resolve to nothing (the same answer as
   * an unknown id).
   */
  private async findChat(
    manager: EntityManager,
    auth: AuthContext,
    id: string,
  ): Promise<ResolvedChat | null> {
    if (!isUUID(id)) return null;
    const root = await manager.findOne(ChatMessage, {
      where: { id, workspaceId: auth.workspaceId, parentId: IsNull() },
    });
    if (root && !root.deletedAt) {
      const room = await manager.findOne(Room, {
        where: { id: root.roomId },
        relations: { agent: true },
      });
      const scope = room ? await this.store.scopeOf(manager, room, auth.memberId) : null;
      return scope ? { ...scope, id: root.id, kind: 'thread', root } : null;
    }
    const room = await manager.findOne(Room, {
      where: { id, workspaceId: auth.workspaceId, kind: 'dm', memberId: auth.memberId },
      relations: { agent: true },
    });
    // A deleted agent's DM is gone for clients (the join skips soft-deleted agents).
    const scope = room ? await this.store.scopeOf(manager, room, auth.memberId) : null;
    return scope ? { ...scope, id: scope.room.id, kind: 'dm', root: null } : null;
  }

  /** The chat a message belongs to, for runners (no caller: nothing is hidden, even a deleted agent's DM). */
  private async chatOfMessage(
    manager: EntityManager,
    message: ChatMessage,
  ): Promise<ResolvedChat | null> {
    const room = await manager.findOneBy(Room, { id: message.roomId });
    const scope = room ? await this.store.scopeOf(manager, room, null, false) : null;
    if (!scope) return null;
    const root = message.parentId
      ? await manager.findOneBy(ChatMessage, { id: message.parentId })
      : null;
    return root
      ? { ...scope, id: root.id, kind: 'thread', root }
      : { ...scope, id: scope.room.id, kind: 'dm', root: null };
  }
}

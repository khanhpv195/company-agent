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
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ClockService } from '../../common/clock';
import { agentConfig } from '../../config';
import {
  requestLanguage,
  returnedRows,
  transactionWithEffects,
  type AfterCommit,
} from '../../common/utils';
import type { AuthContext } from '../../common/types';
import { deriveAgentStatus } from '../agents/agent-status.util';
import { Agent } from '../agents/entities/agent.entity';
import { EventsService } from '../events';
import { ASSIGNMENT_ENDED_EVENT, type AssignmentEndedPayload } from '../events/events.service';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Assignment } from '../gateway/entities/assignment.entity';
import { AgentActivity } from '../agents/entities/agent-activity.entity';
import {
  CHAT_REPLY_REQUESTED_EVENT,
  CHAT_RUN_ENDED_EVENT,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PAGE_LIMIT,
  type ChatReplyRequestedPayload,
  type ChatRunEndedPayload,
} from './chat.constants';
import { toMessage, toRoom, toThread, type LastMessage } from './chat.mapper';
import { previewOf } from './chat.util';
import { ensureDmRoom } from './dm-room';
import { roomAgentIds, roomMemberIds } from './room-access';
import type { SendMessageDto } from './dto/chat.dto';
import { ChatMessage, type ChatKind } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';
import { Thread } from './entities/thread.entity';

/** Why a reply that was in flight when the server stopped ends as failed. */
const RESTART_ERROR = 'Server restarted before the reply finished';
const STALE_STATUSES = ['pending', 'offered', 'claimed', 'running'];

/** A chat the caller may use: a DM of their own or any thread of their workspace. */
export interface ResolvedChat {
  id: string;
  kind: ChatKind;
  room: Room;
  thread: Thread | null;
  /** The agent of the connection a connected inbox thread belongs to. */
  connectionAgentId?: string | null;
  /**
   * The only members who may see this chat's events: a DM's member, a channel's live members.
   * undefined = the whole workspace (connection inboxes are visible to everybody).
   */
  audience: string[] | undefined;
  /** Agents that belong to the channel; null when membership does not restrict them (DMs, inboxes). */
  roomAgentIds: string[] | null;
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

/** DMs go to their member only, channel threads to the channel's members (inboxes to all). */
export const audienceOf = (chat: Pick<ResolvedChat, 'audience'>): string[] | undefined =>
  chat.audience;

/** Neutral `where` of an agent activity for a private channel (the real name stays private). */
export const PRIVATE_CHANNEL_WHERE = 'Kênh riêng';

const audienceOfDm = (room: Room): string[] | undefined =>
  room.memberId ? [room.memberId] : undefined;

@Injectable()
export class ChatService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly gateway: AgentGatewayService,
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
         FROM stale WHERE m.assignment_id = stale.id AND m.status = 'streaming'
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
    const channelIds = rooms.filter((room) => room.kind === 'channel').map((room) => room.id);
    const threads = channelIds.length
      ? await manager
          .createQueryBuilder(Thread, 't')
          .where('t.workspace_id = :workspaceId AND t.room_id IN (:...channelIds)', {
            workspaceId,
            channelIds,
          })
          .orderBy('t.created_at', 'ASC')
          .addOrderBy('t.id', 'ASC')
          .getMany()
      : [];

    const chatIds = [
      ...rooms.filter((room) => room.kind === 'dm').map((room) => room.id),
      ...threads.map((thread) => thread.id),
    ];
    const lastByChat = new Map<string, LastMessage>();
    const unreadByChat = new Map<string, number>();
    if (chatIds.length) {
      const lasts = returnedRows<{ chat_id: string; markdown: string; created_at: Date }>(
        await manager.query(
          `SELECT DISTINCT ON (chat_id) chat_id, markdown, created_at
           FROM messages
           WHERE workspace_id = $1 AND chat_id = ANY($2::uuid[])
           ORDER BY chat_id, seq DESC`,
          [workspaceId, chatIds],
        ),
      );
      for (const row of lasts) {
        lastByChat.set(row.chat_id, { markdown: row.markdown, createdAt: row.created_at });
      }
      const unread = returnedRows<{ chat_id: string; unread: string }>(
        await manager.query(
          `SELECT m.chat_id, count(*) AS unread
           FROM messages m
           LEFT JOIN thread_reads r ON r.chat_id = m.chat_id AND r.member_id = $3
           WHERE m.workspace_id = $1 AND m.chat_id = ANY($2::uuid[]) AND m.chat_kind = 'thread'
             AND m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
             AND NOT (m.author_kind = 'human' AND m.author_member_id = $3)
           GROUP BY m.chat_id`,
          [workspaceId, chatIds, memberId],
        ),
      );
      for (const row of unread) unreadByChat.set(row.chat_id, Number(row.unread));
    }

    const threadsByRoom = new Map<string, ThreadContract[]>();
    for (const thread of threads) {
      const list = threadsByRoom.get(thread.roomId) ?? [];
      list.push(
        toThread(thread, lastByChat.get(thread.id), unreadByChat.get(thread.id) ?? 0, previewOf),
      );
      threadsByRoom.set(thread.roomId, list);
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

  /** Oldest first, the latest 200. */
  async listMessages(auth: AuthContext, id: string): Promise<Message[]> {
    const manager = this.dataSource.manager;
    const chat = await this.requireChat(manager, auth, id);
    const rows = await manager
      .createQueryBuilder(ChatMessage, 'm')
      .leftJoinAndSelect('m.assignment', 'a')
      .where('m.workspace_id = :workspaceId AND m.chat_id = :chatId', {
        workspaceId: auth.workspaceId,
        chatId: chat.id,
      })
      .orderBy('m.seq', 'DESC')
      .limit(MESSAGES_PAGE_LIMIT)
      .getMany();
    return rows.reverse().map(toMessage);
  }

  // ---------- commands ----------

  /**
   * Stores the human message and, when an agent is addressed, its placeholder reply with a
   * pending chat assignment (all in one transaction). A runner (the simulator today, a daemon
   * later) picks the reply up after the commit through `chat.reply.requested`.
   */
  async sendMessage(
    auth: AuthContext,
    chatId: string,
    dto: SendMessageDto,
    /** Join the caller's transaction (its effects fire after its commit) instead of opening one. */
    tx?: { manager: EntityManager; effects: AfterCommit[] },
  ): Promise<Message> {
    const text = dto.markdown?.trim();
    if (!text) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });

    const run = async (manager: EntityManager, effects: AfterCommit[]): Promise<Message> => {
      const chat = await this.requireChat(manager, auth, chatId);
      const agents = await manager.find(Agent, {
        where: { workspaceId: auth.workspaceId },
        relations: { computer: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      const target = this.pickTarget(chat, agents, text, dto.agentId);
      const audience = audienceOf(chat);

      const human = await manager.save(
        manager.create(ChatMessage, {
          workspaceId: auth.workspaceId,
          chatId: chat.id,
          chatKind: chat.kind,
          authorKind: 'human',
          authorMemberId: auth.memberId,
          status: 'complete',
          markdown: text,
          draft: null,
          createdAt: this.clock.now(),
        }),
      );
      const humanMessage = toMessage(human);
      effects.push(() => this.publishMessage(auth.workspaceId, humanMessage, audience));

      if (target) {
        const replyId = randomUUID();
        const tx = { manager, effects };
        let assignment = await this.gateway.create(
          {
            workspaceId: auth.workspaceId,
            agentId: target.id,
            sourceKind: 'chat',
            sourceId: replyId,
            activation: text,
            lang: requestLanguage(),
            requestedByMemberId: auth.memberId,
          },
          tx,
        );
        // A real daemon polls for offered work, so its reply is offered right away; only
        // simulated computers stay `pending` for the in-process simulator to drive.
        const simulated = target.computer.simulated;
        if (!simulated) assignment = await this.gateway.offer(assignment.id, tx);
        const reply = await manager.save(
          manager.create(ChatMessage, {
            id: replyId,
            workspaceId: auth.workspaceId,
            chatId: chat.id,
            chatKind: chat.kind,
            authorKind: 'agent',
            authorAgentId: target.id,
            status: 'streaming',
            markdown: '',
            assignmentId: assignment.id,
            draft: null,
            createdAt: this.clock.now(),
          }),
        );
        reply.assignment = assignment;
        const replyMessage = toMessage(reply);
        effects.push(() => this.publishMessage(auth.workspaceId, replyMessage, audience));
        if (simulated) {
          effects.push(() => this.emitReplyRequested(auth.workspaceId, assignment.id));
        }
      }
      effects.push(() => this.publishRoomsChanged(auth.workspaceId, audience));
      return humanMessage;
    };
    return tx ? run(tx.manager, tx.effects) : transactionWithEffects(this.dataSource, run);
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
      const chat = row ? await this.findChat(manager, auth, row.chatId) : null;
      if (!row || !row.draft || !chat)
        throw new NotFoundException({ message: 'chat.DRAFT_NOT_FOUND' });
      if (row.draft.state !== 'sent') {
        row.draft = { ...row.draft, state: 'sent' };
        await manager.update(ChatMessage, { id: row.id }, { draft: row.draft });
      }
      const message = toMessage(row);
      effects.push(() => this.publishMessage(auth.workspaceId, message, audienceOf(chat)));
      return message;
    });
  }

  /**
   * A message an agent posts on its own (the `post_message` tool), visible exactly like the
   * requester sees the chat: a DM of another member or a foreign chat is "not found". No reply
   * is requested, so agents never trigger each other.
   */
  async postAgentMessage(
    auth: AuthContext,
    agentId: string,
    chatId: string,
    markdown: string,
  ): Promise<Message> {
    const text = markdown?.trim();
    if (!text) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ message: 'chat.MESSAGE_TOO_LONG' });
    }
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const chat = await this.requireChat(manager, auth, chatId);
      if (chat.kind === 'dm' && chat.room.agentId !== agentId) {
        throw new BadRequestException({ message: 'chat.UNKNOWN_AGENT' });
      }
      if (chat.roomAgentIds && !chat.roomAgentIds.includes(agentId)) {
        throw new BadRequestException({ message: 'chat.AGENT_NOT_IN_ROOM' });
      }
      const row = await manager.save(
        manager.create(ChatMessage, {
          workspaceId: auth.workspaceId,
          chatId: chat.id,
          chatKind: chat.kind,
          authorKind: 'agent',
          authorAgentId: agentId,
          status: 'complete',
          markdown: text,
          assignmentId: null,
          draft: null,
          createdAt: this.clock.now(),
        }),
      );
      const message = toMessage(row);
      const audience = audienceOf(chat);
      effects.push(() => this.publishMessage(auth.workspaceId, message, audience));
      effects.push(() => this.publishRoomsChanged(auth.workspaceId, audience));
      return message;
    });
  }

  /** The chat id (DM room or thread) of a chat reply assignment, or null. */
  async chatIdOfReply(assignmentId: string): Promise<string | null> {
    const rows = returnedRows<{ chat_id: string }>(
      await this.dataSource.query(
        `SELECT m.chat_id FROM messages m WHERE m.assignment_id = $1 LIMIT 1`,
        [assignmentId],
      ),
    );
    return rows[0]?.chat_id ?? null;
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
    const dm = ctx.chat.kind === 'dm';
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
      memberIds: audienceOf(chat),
      where:
        chat.kind === 'dm'
          ? 'DM'
          : chat.room.isPrivate
            ? PRIVATE_CHANNEL_WHERE
            : `# ${chat.room.name} › ${chat.thread?.name ?? ''}`,
    };
  }

  /**
   * Who may see a chat's events right now (a thread's room members, a DM's member, undefined =
   * the whole workspace for an inbox). Streams call this on every publish so a member removed
   * from a private room mid-reply stops receiving chunks. `null` = the chat is gone.
   */
  async currentAudience(chatId: string): Promise<{ audience: string[] | undefined } | null> {
    const manager = this.dataSource.manager;
    const rows = returnedRows<{
      kind: 'thread' | 'dm';
      room_id: string;
      member_id: string | null;
      connection_id: string | null;
    }>(
      await manager.query(
        `SELECT 'thread' AS kind, r.id AS room_id, r.member_id, r.connection_id
         FROM threads t JOIN rooms r ON r.id = t.room_id WHERE t.id = $1
         UNION ALL
         SELECT 'dm', r.id, r.member_id, r.connection_id FROM rooms r WHERE r.id = $1 AND r.kind = 'dm'`,
        [chatId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    if (row.kind === 'dm') return { audience: row.member_id ? [row.member_id] : undefined };
    if (row.connection_id) return { audience: undefined };
    return { audience: await roomMemberIds(manager, row.room_id) };
  }

  /** The message as clients see it, with its assignment's current state. */
  async loadMessage(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Message> {
    const row = await manager.findOneOrFail(ChatMessage, {
      where: { id },
      relations: { assignment: true },
    });
    return toMessage(row);
  }

  publishMessage(
    workspaceId: string,
    message: Message,
    memberIds: readonly string[] | undefined,
  ): void {
    this.events.publish(workspaceId, { type: 'message.upserted', message }, { memberIds });
  }

  publishRoomsChanged(workspaceId: string, memberIds: readonly string[] | undefined): void {
    this.events.publish(workspaceId, { type: 'rooms.changed' }, { memberIds });
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
           WHERE assignment_id = $1 AND status = 'streaming' RETURNING id`,
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

  /**
   * Who answers: an explicit agent of this workspace, else the first agent of the chat whose
   * `@name` the text mentions (case-sensitive), else a DM's partner, else nobody. Only agents
   * that belong to the channel can be woken: mentioning another agent just posts the message.
   */
  private pickTarget(
    chat: ResolvedChat,
    agents: Agent[],
    text: string,
    explicitId: string | undefined,
  ): Agent | undefined {
    if (explicitId) {
      const explicit = agents.find((agent) => agent.id === explicitId);
      if (!explicit || (chat.kind === 'dm' && explicit.id !== chat.room.agentId))
        throw new BadRequestException({ message: 'chat.UNKNOWN_AGENT' });
      if (chat.roomAgentIds && !chat.roomAgentIds.includes(explicit.id))
        throw new BadRequestException({ message: 'chat.AGENT_NOT_IN_ROOM' });
      return explicit;
    }
    const inChat = this.agentsOfChat(chat, agents);
    return (
      inChat.find((agent) => text.includes('@' + agent.name)) ??
      (chat.kind === 'dm' ? inChat[0] : undefined)
    );
  }

  /**
   * DM: the partner. A connected inbox thread: the connection's agent. Any other thread:
   * the channel's agents whose computer is not offline, in workspace order.
   */
  private agentsOfChat(chat: ResolvedChat, agents: Agent[]): Agent[] {
    if (chat.kind === 'dm') return agents.filter((agent) => agent.id === chat.room.agentId);
    if (chat.connectionAgentId)
      return agents.filter((agent) => agent.id === chat.connectionAgentId);
    const members = chat.roomAgentIds;
    return agents.filter(
      (agent) =>
        (!members || members.includes(agent.id)) &&
        deriveAgentStatus(agent.computer.status, false) !== 'offline',
    );
  }

  private async toChat(manager: EntityManager, chat: ResolvedChat): Promise<Chat> {
    const agents = await manager.find(Agent, {
      where: { workspaceId: chat.room.workspaceId },
      relations: { computer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const agentIds = this.agentsOfChat(chat, agents).map((agent) => agent.id);
    if (chat.kind === 'dm') {
      const partner = agents.find((agent) => agent.id === chat.room.agentId);
      return {
        id: chat.id,
        kind: 'dm',
        title: partner?.name ?? chat.room.name,
        subtitle: null,
        agentIds,
      };
    }
    return {
      id: chat.id,
      kind: 'thread',
      title: chat.thread?.name ?? '',
      subtitle: `# ${chat.room.name}`,
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
   * A thread id first, then a DM room id. A DM of another member and anything of another
   * workspace resolve to nothing (the same answer as an unknown id).
   */
  private async findChat(
    manager: EntityManager,
    auth: AuthContext,
    id: string,
  ): Promise<ResolvedChat | null> {
    if (!isUUID(id)) return null;
    const thread = await manager.findOne(Thread, {
      where: { id, workspaceId: auth.workspaceId },
      relations: { room: true },
    });
    if (thread) {
      const scope = await this.channelScope(manager, thread.room, auth.memberId);
      if (!scope) return null;
      return {
        id: thread.id,
        kind: 'thread',
        room: thread.room,
        thread,
        connectionAgentId: await this.connectionAgentOf(manager, thread),
        ...scope,
      };
    }
    const room = await manager.findOne(Room, {
      where: { id, workspaceId: auth.workspaceId, kind: 'dm', memberId: auth.memberId },
      relations: { agent: true },
    });
    // A deleted agent's DM is gone for clients (the join skips soft-deleted agents).
    return room?.agent
      ? {
          id: room.id,
          kind: 'dm',
          room,
          thread: null,
          audience: audienceOfDm(room),
          roomAgentIds: null,
        }
      : null;
  }

  /**
   * Who may see a channel's chats and which agents it holds. Connection inboxes are open to
   * the whole workspace (no restriction); any other channel needs the caller's membership
   * (null = not a member, which looks like an unknown chat). Pass no member to skip the check.
   */
  private async channelScope(
    manager: EntityManager,
    room: Room,
    memberId: string | null,
  ): Promise<{ audience: string[] | undefined; roomAgentIds: string[] | null } | null> {
    if (room.connectionId) return { audience: undefined, roomAgentIds: null };
    const audience = await roomMemberIds(manager, room.id);
    if (memberId && !audience.includes(memberId)) return null;
    return { audience, roomAgentIds: await roomAgentIds(manager, room.id) };
  }

  /** The agent of the connection behind an inbox thread (plain query: no module cycle). */
  private async connectionAgentOf(manager: EntityManager, thread: Thread): Promise<string | null> {
    if (!thread.connectionId) return null;
    const rows = returnedRows<{ agent_id: string | null }>(
      await manager.query(
        `SELECT agent_id FROM workspace_connections WHERE workspace_id = $1 AND provider = $2`,
        [thread.workspaceId, thread.connectionId],
      ),
    );
    return rows[0]?.agent_id ?? null;
  }

  private async chatOfMessage(
    manager: EntityManager,
    message: ChatMessage,
  ): Promise<ResolvedChat | null> {
    if (message.chatKind === 'thread') {
      const thread = await manager.findOne(Thread, {
        where: { id: message.chatId },
        relations: { room: true },
      });
      if (!thread) return null;
      const scope = await this.channelScope(manager, thread.room, null);
      return scope ? { id: thread.id, kind: 'thread', room: thread.room, thread, ...scope } : null;
    }
    const room = await manager.findOneBy(Room, { id: message.chatId });
    return room
      ? {
          id: room.id,
          kind: 'dm',
          room,
          thread: null,
          audience: audienceOfDm(room),
          roomAgentIds: null,
        }
      : null;
  }

  private emitReplyRequested(workspaceId: string, assignmentId: string): void {
    const payload: ChatReplyRequestedPayload = { workspaceId, assignmentId };
    this.emitter.emit(CHAT_REPLY_REQUESTED_EVENT, payload);
  }
}

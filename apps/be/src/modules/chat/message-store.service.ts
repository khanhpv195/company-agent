import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  Message,
  MessageQuote,
  MessageThread,
  RoomKind,
  SkippedAgent,
  RoomTimelinePage,
  ThreadPage,
} from '@repo/shared';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import {
  requestLanguage,
  returnedRows,
  transactionWithEffects,
  type AfterCommit,
} from '../../common/utils';
import { deriveAgentStatus } from '../agents/agent-status.util';
import { Agent } from '../agents/entities/agent.entity';
import { EventsService } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Assignment } from '../gateway/entities/assignment.entity';
import {
  CHAT_REPLY_REQUESTED_EVENT,
  MAX_MESSAGE_LENGTH,
  MAX_WAKE_PER_MESSAGE,
  THREAD_NAME_MAX,
  type ChatReplyRequestedPayload,
} from './chat.constants';
import { toMessage } from './chat.mapper';
import { mentionedAgents } from './mentions';
import { roomAgentIds, roomMemberIds } from './room-access';
import { ChatMessage } from './entities/chat-message.entity';
import { Room } from './entities/room.entity';

const OPEN_STATUSES = ['pending', 'offered', 'claimed', 'running'];
const PARTICIPANTS_MAX = 5;
const QUOTE_EXCERPT = 140;
const CLIENT_ID_INDEX = 'UQ_messages_client_id';
const ROOM_FK = 'FK_1dda4fc8dbeeff2ee71f0088ba0';
const PARENT_FK = 'FK_932abe146b78bd584b4d1851ce3';

/** Who may see a room and which agents it holds. */
export interface RoomScope {
  room: Room;
  /**
   * The only members who may see this room's events: a DM's member, a channel's live members.
   * undefined = the whole workspace (connection inboxes are visible to everybody).
   */
  audience: string[] | undefined;
  /** Agents that belong to the channel; null when membership does not restrict them (DMs, inboxes). */
  roomAgentIds: string[] | null;
  /** The caller's role in a channel (null: DM, or an inbox they were not added to). */
  role: 'owner' | 'member' | null;
  /** The agent of the connection an inbox room belongs to. */
  connectionAgentId: string | null;
}

export interface SendInput {
  markdown: string;
  /** A message of the room; a reply id attaches to its root. */
  parentId?: string | null;
  threadTitle?: string;
  quoteMessageId?: string;
  clientMessageId?: string;
  agentId?: string;
  /** Text to look for @mentions in, when it differs from `markdown` (a fallback text has none). */
  mentionsFrom?: string;
}

export interface SendTx {
  manager: EntityManager;
  effects: AfterCommit[];
}

const isAdmin = (auth: Pick<AuthContext, 'role'>): boolean =>
  auth.role === 'owner' || auth.role === 'admin';

const violatedClientId = (error: unknown): boolean => {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  return driver?.code === '23505' && driver.constraint === CLIENT_ID_INDEX;
};

/** Which foreign key a write violated (a concurrent delete of the room or of the root). */
const violatedForeignKey = (error: unknown): string | null => {
  if (!(error instanceof QueryFailedError)) return null;
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  return driver?.code === '23503' ? (driver.constraint ?? null) : null;
};

const excerptOf = (markdown: string): string => {
  const flat = markdown.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE_EXCERPT ? `${flat.slice(0, QUOTE_EXCERPT - 3)}...` : flat;
};

/**
 * Room timelines: reading, sending, editing and deleting messages and renaming threads, plus
 * the hydration (thread summary, quote, assignment) and realtime publishing every other chat
 * service shares. A room has one main timeline (messages without `parent_id`); a thread is the
 * replies to one root message. `ChatService` (legacy chat routes, runner support) sits on top.
 */
@Injectable()
export class MessageStore {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly gateway: AgentGatewayService,
  ) {}

  // ---------- access ----------

  /**
   * Who may see a room, or null for "not found": a DM of another member or of a deleted agent,
   * and any channel the caller is not in (inboxes are open to the whole workspace). Pass no
   * member to skip the membership check (runners resolving a message's room).
   */
  async scopeOf(
    manager: EntityManager,
    room: Room,
    memberId: string | null,
    /** A DM whose agent was deleted is gone for clients, but a runner must still resolve it. */
    requireAgent = true,
  ): Promise<RoomScope | null> {
    if (room.kind === 'dm') {
      if (memberId && room.memberId !== memberId) return null;
      if (requireAgent) {
        const agent =
          room.agent === undefined
            ? await manager.findOneBy(Agent, { id: room.agentId ?? '' })
            : room.agent;
        if (!agent) return null;
      }
      return {
        room,
        audience: room.memberId ? [room.memberId] : undefined,
        roomAgentIds: null,
        role: null,
        connectionAgentId: null,
      };
    }
    const own = memberId
      ? returnedRows<{ role: 'owner' | 'member' }>(
          await manager.query(
            `SELECT role FROM room_members WHERE room_id = $1 AND member_id = $2`,
            [room.id, memberId],
          ),
        )[0]?.role
      : undefined;
    if (room.connectionId) {
      const rows = returnedRows<{ agent_id: string | null }>(
        await manager.query(
          `SELECT agent_id FROM workspace_connections WHERE workspace_id = $1 AND provider = $2`,
          [room.workspaceId, room.connectionId],
        ),
      );
      return {
        room,
        audience: undefined,
        roomAgentIds: null,
        role: own ?? null,
        connectionAgentId: rows[0]?.agent_id ?? null,
      };
    }
    const audience = await roomMemberIds(manager, room.id);
    if (memberId && !audience.includes(memberId)) return null;
    return {
      room,
      audience,
      roomAgentIds: await roomAgentIds(manager, room.id),
      role: own ?? null,
      connectionAgentId: null,
    };
  }

  /** The room as the caller may use it; anything else answers 404 `chat.ROOM_NOT_FOUND`. */
  async resolveRoom(manager: EntityManager, auth: AuthContext, id: string): Promise<RoomScope> {
    const room = isUUID(id)
      ? await manager.findOne(Room, {
          where: { id, workspaceId: auth.workspaceId },
          relations: { agent: true },
        })
      : null;
    const scope = room ? await this.scopeOf(manager, room, auth.memberId) : null;
    if (!scope) throw new NotFoundException({ message: 'chat.ROOM_NOT_FOUND', args: { id } });
    return scope;
  }

  /**
   * The root of a thread: `id` may be a root or one of its replies. Missing, foreign or deleted
   * roots are 404 `chat.MESSAGE_NOT_FOUND`.
   */
  async resolveRoot(manager: EntityManager, room: Room, id: string): Promise<ChatMessage> {
    const notFound = () =>
      new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id } });
    if (!isUUID(id)) throw notFound();
    let row = await manager.findOneBy(ChatMessage, { id, roomId: room.id });
    if (row?.parentId) row = await manager.findOneBy(ChatMessage, { id: row.parentId });
    if (!row || row.roomId !== room.id || row.deletedAt) throw notFound();
    return row;
  }

  // ---------- hydration ----------

  /** Messages as clients see them: assignment, thread summary of roots, quote and chat id. */
  async hydrate(manager: EntityManager, rows: ChatMessage[]): Promise<Message[]> {
    if (!rows.length) return [];
    const missing = rows.filter((row) => row.assignmentId && !row.assignment);
    const assignments = new Map<string, Assignment>();
    if (missing.length) {
      for (const a of await manager.findBy(Assignment, {
        id: In(missing.map((row) => row.assignmentId as string)),
      })) {
        assignments.set(a.id, a);
      }
    }
    const roomIds = [...new Set(rows.map((row) => row.roomId))];
    const kinds = new Map(
      returnedRows<{ id: string; kind: RoomKind }>(
        await manager.query(`SELECT id, kind FROM rooms WHERE id = ANY($1::uuid[])`, [roomIds]),
      ).map((row) => [row.id, row.kind]),
    );
    const threadRoots = rows.filter(
      (row) => !row.parentId && !row.deletedAt && (row.threadTitle != null || row.replyCount > 0),
    );
    const participants = await this.participantsOf(manager, threadRoots);
    const quotes = await this.quotesOf(
      manager,
      rows.filter((row) => row.quoteMessageId && !row.deletedAt),
    );
    return rows.map((row) => {
      const withAssignment =
        row.assignmentId && !row.assignment
          ? Object.assign(row, { assignment: assignments.get(row.assignmentId) ?? null })
          : row;
      const thread: MessageThread | undefined = threadRoots.includes(row)
        ? {
            title: row.threadTitle ?? null,
            replyCount: row.replyCount,
            lastReplyAt: row.lastReplyAt ? row.lastReplyAt.toISOString() : null,
            participantIds: participants.get(row.id) ?? [],
          }
        : undefined;
      return toMessage(withAssignment, {
        roomKind: kinds.get(row.roomId) ?? 'channel',
        thread,
        quote: row.quoteMessageId ? (quotes.get(row.quoteMessageId) ?? null) : null,
      });
    });
  }

  async loadMessage(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Message> {
    const row = await manager.findOneOrFail(ChatMessage, {
      where: { id },
      relations: { assignment: true },
    });
    return (await this.hydrate(manager, [row]))[0];
  }

  /** The root author and the repliers (humans and agents), in order of first appearance, at most 5. */
  private async participantsOf(
    manager: EntityManager,
    roots: ChatMessage[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!roots.length) return result;
    const who = (row: { author_member_id: string | null; author_agent_id: string | null }) =>
      row.author_member_id ?? row.author_agent_id;
    const replies = returnedRows<{
      parent_id: string;
      author_member_id: string | null;
      author_agent_id: string | null;
      first_seq: string;
    }>(
      await manager.query(
        `SELECT parent_id, author_member_id, author_agent_id, min(seq) AS first_seq
         FROM messages
         WHERE parent_id = ANY($1::uuid[]) AND deleted_at IS NULL
           AND (author_member_id IS NOT NULL OR author_agent_id IS NOT NULL)
         GROUP BY parent_id, author_member_id, author_agent_id
         ORDER BY parent_id, min(seq)`,
        [roots.map((root) => root.id)],
      ),
    );
    for (const root of roots) {
      const ids: string[] = [];
      const first = root.authorMemberId ?? root.authorAgentId;
      if (first) ids.push(first);
      for (const row of replies.filter((reply) => reply.parent_id === root.id)) {
        const id = who(row);
        if (id && !ids.includes(id)) ids.push(id);
      }
      result.set(root.id, ids.slice(0, PARTICIPANTS_MAX));
    }
    return result;
  }

  private async quotesOf(
    manager: EntityManager,
    rows: ChatMessage[],
  ): Promise<Map<string, MessageQuote>> {
    const result = new Map<string, MessageQuote>();
    const ids = [...new Set(rows.map((row) => row.quoteMessageId as string))];
    if (!ids.length) return result;
    for (const row of returnedRows<{
      id: string;
      markdown: string;
      deleted_at: Date | null;
      root_deleted_at: Date | null;
      member_name: string | null;
      agent_name: string | null;
      external_name: string | null;
    }>(
      await manager.query(
        `SELECT m.id, m.markdown, m.deleted_at, root.deleted_at AS root_deleted_at,
                mem.name AS member_name, ag.name AS agent_name, m.external_name
         FROM messages m
         LEFT JOIN messages root ON root.id = m.parent_id
         LEFT JOIN members mem ON mem.id = m.author_member_id
         LEFT JOIN agents ag ON ag.id = m.author_agent_id
         WHERE m.id = ANY($1::uuid[])`,
        [ids],
      ),
    )) {
      result.set(row.id, {
        id: row.id,
        authorName: row.member_name ?? row.agent_name ?? row.external_name ?? '',
        // A reply of a deleted root is hidden with it.
        excerpt: row.deleted_at || row.root_deleted_at ? '' : excerptOf(row.markdown),
      });
    }
    return result;
  }

  // ---------- publishing ----------

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

  /** After the commit: `thread.updated` with the counters of each root, read inside the transaction. */
  async queueThreadUpdates(
    manager: EntityManager,
    effects: AfterCommit[],
    workspaceId: string,
    rootIds: string[],
    audience: string[] | undefined,
  ): Promise<void> {
    if (!rootIds.length) return;
    const rows = returnedRows<{
      id: string;
      room_id: string;
      thread_title: string | null;
      reply_count: number;
      last_reply_at: Date | null;
    }>(
      await manager.query(
        `SELECT id, room_id, thread_title, reply_count, last_reply_at FROM messages WHERE id = ANY($1::uuid[])`,
        [rootIds],
      ),
    );
    for (const row of rows) {
      effects.push(() =>
        this.events.publish(
          workspaceId,
          {
            type: 'thread.updated',
            roomId: row.room_id,
            rootId: row.id,
            title: row.thread_title,
            replyCount: Number(row.reply_count),
            lastReplyAt: row.last_reply_at ? row.last_reply_at.toISOString() : null,
          },
          { memberIds: audience },
        ),
      );
    }
  }

  // ---------- reads ----------

  /** The main timeline (roots and plain messages), oldest first within the page. */
  async timeline(
    auth: AuthContext,
    roomId: string,
    query: { beforeSeq?: string; limit: number },
  ): Promise<RoomTimelinePage> {
    const manager = this.dataSource.manager;
    const scope = await this.resolveRoom(manager, auth, roomId);
    const qb = manager
      .createQueryBuilder(ChatMessage, 'm')
      .leftJoinAndSelect('m.assignment', 'a')
      .where('m.room_id = :roomId AND m.parent_id IS NULL', { roomId: scope.room.id });
    if (query.beforeSeq !== undefined)
      qb.andWhere('m.seq < :beforeSeq', { beforeSeq: query.beforeSeq });
    // Only migrated placeholder roots can share a seq; the creation time orders those.
    const rows = await qb
      .orderBy('m.seq', 'DESC')
      .addOrderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .limit(query.limit + 1)
      .getMany();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();
    return { messages: await this.hydrate(manager, page), hasMore };
  }

  /** A thread: its root and replies after `afterSeq`, oldest first. */
  async thread(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    query: { afterSeq?: string; limit: number },
  ): Promise<ThreadPage> {
    const manager = this.dataSource.manager;
    const scope = await this.resolveRoom(manager, auth, roomId);
    const root = await this.resolveRoot(manager, scope.room, rootId);
    const qb = manager
      .createQueryBuilder(ChatMessage, 'm')
      .leftJoinAndSelect('m.assignment', 'a')
      .where('m.parent_id = :rootId', { rootId: root.id });
    if (query.afterSeq !== undefined)
      qb.andWhere('m.seq > :afterSeq', { afterSeq: query.afterSeq });
    const rows = await qb
      .orderBy('m.seq', 'ASC')
      .limit(query.limit + 1)
      .getMany();
    const hasMore = rows.length > query.limit;
    const [hydratedRoot, ...replies] = await this.hydrate(manager, [
      root,
      ...rows.slice(0, query.limit),
    ]);
    return { root: hydratedRoot, replies, hasMore };
  }

  // ---------- send ----------

  /**
   * Stores the human message and, for every addressed agent (explicit, then @mentions, at most
   * 3), a placeholder reply with its own pending chat assignment, all in one transaction. A
   * runner (the simulator, a daemon) picks the reply up after the commit.
   *
   * Replies go where the trigger was posted: a main-timeline channel message becomes the root of
   * a thread and the agent answers under it, a message inside a thread is answered in that
   * thread, a DM main-timeline message in the DM main timeline.
   */
  async send(auth: AuthContext, roomId: string, input: SendInput, tx?: SendTx): Promise<Message> {
    if (tx) return this.sendIn(tx.manager, tx.effects, auth, roomId, input);
    try {
      return await transactionWithEffects(this.dataSource, (manager, effects) =>
        this.sendIn(manager, effects, auth, roomId, input),
      );
    } catch (error) {
      // A concurrent retry with the same client id won the race: answer with its message.
      if (input.clientMessageId && violatedClientId(error)) {
        const existing = await this.findByClientId(
          this.dataSource.manager,
          roomId,
          auth.memberId,
          input.clientMessageId,
        );
        if (existing) return existing;
      }
      // The room (or the thread's root) was deleted while the message was being stored.
      const violated = violatedForeignKey(error);
      if (violated === ROOM_FK) {
        throw new NotFoundException({ message: 'chat.ROOM_NOT_FOUND', args: { id: roomId } });
      }
      if (violated === PARENT_FK) {
        throw new NotFoundException({
          message: 'chat.MESSAGE_NOT_FOUND',
          args: { id: input.parentId ?? '' },
        });
      }
      throw error;
    }
  }

  private async findByClientId(
    manager: EntityManager,
    roomId: string,
    memberId: string,
    clientMessageId: string,
  ): Promise<Message | null> {
    const row = await manager.findOne(ChatMessage, {
      where: { roomId, authorMemberId: memberId, clientMessageId },
      relations: { assignment: true },
    });
    return row ? (await this.hydrate(manager, [row]))[0] : null;
  }

  private async sendIn(
    manager: EntityManager,
    effects: AfterCommit[],
    auth: AuthContext,
    roomId: string,
    input: SendInput,
  ): Promise<Message> {
    const text = input.markdown?.trim();
    if (!text) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ message: 'chat.MESSAGE_TOO_LONG' });
    }
    const title = input.threadTitle?.trim();
    if (input.threadTitle !== undefined) {
      if (input.parentId) {
        throw new BadRequestException({ message: 'chat.THREAD_TITLE_WITH_PARENT' });
      }
      if (!title || title.length > THREAD_NAME_MAX) {
        throw new BadRequestException({ message: 'chat.THREAD_TITLE_INVALID' });
      }
    }
    const scope = await this.resolveRoom(manager, auth, roomId);
    const { room } = scope;

    const clientId = input.clientMessageId?.trim() || undefined;
    if (clientId) {
      const existing = await this.findByClientId(manager, room.id, auth.memberId, clientId);
      if (existing) return existing;
    }
    const root = input.parentId ? await this.resolveRoot(manager, room, input.parentId) : null;
    let quoteId: string | null = null;
    if (input.quoteMessageId) {
      const quoted = isUUID(input.quoteMessageId)
        ? await manager.findOneBy(ChatMessage, { id: input.quoteMessageId, roomId: room.id })
        : null;
      if (!quoted) throw new BadRequestException({ message: 'chat.QUOTE_NOT_FOUND' });
      quoteId = quoted.id;
    }

    const agents = await manager.find(Agent, {
      where: { workspaceId: auth.workspaceId },
      relations: { computer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const mentionText = input.mentionsFrom ?? text;
    const continuing =
      root && !mentionedAgents(mentionText, agents).length
        ? await this.threadAgentId(manager, root.id)
        : null;
    const { targets, skipped } = this.pickTargets(
      scope,
      agents,
      mentionText,
      input.agentId,
      continuing,
    );
    // A DM has one partner: with its computer offline nobody would ever answer.
    if (
      room.kind === 'dm' &&
      targets.some((t) => deriveAgentStatus(t.computer.status, false) === 'offline')
    ) {
      throw new ConflictException({ message: 'chat.AGENT_OFFLINE' });
    }

    const now = this.clock.now();
    const human = await manager.save(
      manager.create(ChatMessage, {
        workspaceId: auth.workspaceId,
        roomId: room.id,
        parentId: root?.id ?? null,
        threadTitle: title ?? null,
        authorKind: 'human',
        authorMemberId: auth.memberId,
        status: 'complete',
        markdown: text,
        draft: null,
        clientMessageId: clientId ?? null,
        quoteMessageId: quoteId,
        createdAt: now,
      }),
    );
    const saved: ChatMessage[] = [human];
    // Where the agents answer: under the root, or under the trigger itself in a channel.
    const replyParentId = !targets.length
      ? null
      : root
        ? root.id
        : room.kind === 'dm'
          ? null
          : human.id;

    for (const target of targets) {
      const replyId = randomUUID();
      const gtx = { manager, effects };
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
        gtx,
      );
      // A real daemon polls for offered work, so its reply is offered right away; only
      // simulated computers stay `pending` for the in-process simulator to drive.
      const simulated = target.computer.simulated;
      if (!simulated) assignment = await this.gateway.offer(assignment.id, gtx);
      const reply = await manager.save(
        manager.create(ChatMessage, {
          id: replyId,
          workspaceId: auth.workspaceId,
          roomId: room.id,
          parentId: replyParentId,
          authorKind: 'agent',
          authorAgentId: target.id,
          status: 'streaming',
          markdown: '',
          assignmentId: assignment.id,
          draft: null,
          createdAt: this.clock.now(),
        }),
      );
      saved.push(reply);
      if (simulated) {
        effects.push(() => this.emitReplyRequested(auth.workspaceId, assignment.id));
      }
    }

    // The root(s) a reply lands on (the trigger itself when it starts a thread): same transaction.
    const touched = [
      ...new Set([human.parentId, replyParentId].filter((id): id is string => !!id)),
    ];
    for (const rootId of touched) {
      const replies = saved.filter((row) => row.parentId === rootId);
      await manager.query(
        `UPDATE messages SET reply_count = reply_count + $2, last_reply_at = $3 WHERE id = $1`,
        [rootId, replies.length, replies[replies.length - 1].createdAt],
      );
    }

    const rows = await manager.find(ChatMessage, {
      where: { id: In(saved.map((row) => row.id)) },
      relations: { assignment: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const messages = await this.hydrate(
      manager,
      saved.map((row) => byId.get(row.id) as ChatMessage),
    );
    for (const message of messages) {
      effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
    }
    await this.queueThreadUpdates(manager, effects, auth.workspaceId, touched, scope.audience);
    effects.push(() => this.publishRoomsChanged(auth.workspaceId, scope.audience));
    // Only the sender's answer lists the agents that were not woken (events stay unchanged).
    return skipped.length ? { ...messages[0], skippedAgents: skipped } : messages[0];
  }

  /** The one agent that spoke in a thread, or null when none or several did. */
  private async threadAgentId(manager: EntityManager, rootId: string): Promise<string | null> {
    const rows = returnedRows<{ author_agent_id: string }>(
      await manager.query(
        `SELECT DISTINCT author_agent_id FROM messages
         WHERE parent_id = $1 AND author_kind = 'agent' AND author_agent_id IS NOT NULL
           AND deleted_at IS NULL
         LIMIT 2`,
        [rootId],
      ),
    );
    return rows.length === 1 ? rows[0].author_agent_id : null;
  }

  /**
   * Who answers, at most 3, in order: the explicit agent, the agents `@name`-mentioned in the
   * text (case-insensitive, in mention order), else the one agent that already answered in this
   * thread (`continuing`, a conversation goes on without repeating the mention), else a DM's
   * partner, else nobody. Mentioned agents that are not woken come back in `skipped` (outside
   * the room, computer offline, or over the cap of 3).
   */
  pickTargets(
    scope: RoomScope,
    agents: Agent[],
    text: string,
    explicitId: string | undefined,
    continuing: string | null = null,
  ): { targets: Agent[]; skipped: SkippedAgent[] } {
    const { room } = scope;
    const targets: Agent[] = [];
    const skipped: SkippedAgent[] = [];
    if (explicitId) {
      const explicit = agents.find((agent) => agent.id === explicitId);
      if (!explicit || (room.kind === 'dm' && explicit.id !== room.agentId)) {
        throw new BadRequestException({ message: 'chat.UNKNOWN_AGENT' });
      }
      if (scope.roomAgentIds && !scope.roomAgentIds.includes(explicit.id)) {
        throw new BadRequestException({ message: 'chat.AGENT_NOT_IN_ROOM' });
      }
      targets.push(explicit);
    }
    const candidates = this.wakeable(scope, agents);
    const mentioned = mentionedAgents(text, agents);
    for (const agent of mentioned) {
      if (targets.includes(agent)) continue;
      const skip = (reason: SkippedAgent['reason']) =>
        skipped.push({ agentId: agent.id, name: agent.name, reason });
      if (!this.belongs(scope, agent)) skip('not_in_room');
      else if (!candidates.includes(agent)) skip('offline');
      else if (targets.length >= MAX_WAKE_PER_MESSAGE) skip('limit');
      else targets.push(agent);
    }
    if (!targets.length && !mentioned.length && continuing) {
      const agent = candidates.find((candidate) => candidate.id === continuing);
      if (agent) targets.push(agent);
    }
    if (!targets.length && room.kind === 'dm') targets.push(...candidates);
    return { targets: targets.slice(0, MAX_WAKE_PER_MESSAGE), skipped };
  }

  /** Whether an agent is part of the room (DM partner, inbox agent, channel member). */
  private belongs(scope: RoomScope, agent: Agent): boolean {
    const { room } = scope;
    if (room.kind === 'dm') return agent.id === room.agentId;
    if (room.connectionId) return agent.id === scope.connectionAgentId;
    return !scope.roomAgentIds || scope.roomAgentIds.includes(agent.id);
  }

  /**
   * DM: the partner. A connection inbox: the connection's agent. A channel: its agents whose
   * computer is not offline, in workspace order.
   */
  wakeable(scope: RoomScope, agents: Agent[]): Agent[] {
    const { room } = scope;
    if (room.kind === 'dm') return agents.filter((agent) => agent.id === room.agentId);
    if (room.connectionId) return agents.filter((agent) => agent.id === scope.connectionAgentId);
    const members = scope.roomAgentIds;
    return agents.filter(
      (agent) =>
        (!members || members.includes(agent.id)) &&
        deriveAgentStatus(agent.computer.status, false) !== 'offline',
    );
  }

  /** A message an agent posts on its own (no reply is requested: agents never trigger each other). */
  async insertAgentMessage(
    manager: EntityManager,
    effects: AfterCommit[],
    auth: AuthContext,
    scope: RoomScope,
    rootId: string | null,
    agentId: string,
    text: string,
  ): Promise<Message> {
    const row = await manager.save(
      manager.create(ChatMessage, {
        workspaceId: auth.workspaceId,
        roomId: scope.room.id,
        parentId: rootId,
        authorKind: 'agent',
        authorAgentId: agentId,
        status: 'complete',
        markdown: text,
        assignmentId: null,
        draft: null,
        createdAt: this.clock.now(),
      }),
    );
    if (rootId) {
      await manager.query(
        `UPDATE messages SET reply_count = reply_count + 1, last_reply_at = $2 WHERE id = $1`,
        [rootId, row.createdAt],
      );
    }
    const message = (await this.hydrate(manager, [row]))[0];
    effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
    if (rootId) {
      await this.queueThreadUpdates(manager, effects, auth.workspaceId, [rootId], scope.audience);
    }
    effects.push(() => this.publishRoomsChanged(auth.workspaceId, scope.audience));
    return message;
  }

  // ---------- edit, delete, rename ----------

  /** Own human messages only; sets `editedAt`. Agents are not woken again. */
  async edit(
    auth: AuthContext,
    roomId: string,
    messageId: string,
    markdown: string,
  ): Promise<Message> {
    const text = markdown?.trim();
    if (!text) throw new BadRequestException({ message: 'chat.MESSAGE_EMPTY' });
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ message: 'chat.MESSAGE_TOO_LONG' });
    }
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const scope = await this.resolveRoom(manager, auth, roomId);
      const row = await this.requireMessage(manager, scope.room, messageId);
      if (row.deletedAt || (await this.rootDeleted(manager, row)))
        throw new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id: messageId } });
      if (row.authorKind !== 'human' || row.authorMemberId !== auth.memberId) {
        throw new ForbiddenException({ message: 'chat.NOT_YOUR_MESSAGE' });
      }
      await manager.update(
        ChatMessage,
        { id: row.id },
        { markdown: text, editedAt: this.clock.now() },
      );
      const message = await this.loadMessage(row.id, manager);
      effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
      return message;
    });
  }

  /**
   * Soft delete: the text is cleared and clients get a placeholder (`deleted: true`). Allowed for
   * the author, the room owner, workspace owners/admins and, for an agent reply, the member
   * whose message asked for it. A running agent reply is cancelled;
   * deleting a root hides its replies (their runs are cancelled too).
   */
  async remove(auth: AuthContext, roomId: string, messageId: string): Promise<Message> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const scope = await this.resolveRoom(manager, auth, roomId);
      const row = await this.requireMessage(manager, scope.room, messageId);
      // The replies of a deleted root are gone with it.
      if (await this.rootDeleted(manager, row)) {
        throw new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id: messageId } });
      }
      const own = row.authorKind === 'human' && row.authorMemberId === auth.memberId;
      if (
        !own &&
        scope.role !== 'owner' &&
        !isAdmin(auth) &&
        !(await this.requestedBy(manager, row, auth.memberId))
      ) {
        throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
      }
      if (row.deletedAt) return this.loadMessage(row.id, manager);

      // Runners lock their assignment, then the message: same order here (cancel first).
      const open = returnedRows<{ id: string }>(
        await manager.query(
          `SELECT a.id FROM assignments a
           WHERE a.status = ANY($2::text[])
             AND a.id IN (SELECT m.assignment_id FROM messages m
                          WHERE m.id = ANY($1::uuid[]) OR m.parent_id = ANY($1::uuid[]))
           ORDER BY a.id FOR UPDATE`,
          [[row.id], OPEN_STATUSES],
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
      // Conditional: of two concurrent deletes only the one that flips the row counts the reply.
      const flipped = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE messages SET markdown = '', draft = NULL, deleted_at = $2
           WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
          [row.id, this.clock.now()],
        ),
      );
      if (!flipped.length) return this.loadMessage(row.id, manager);
      if (row.parentId) {
        await manager.query(
          `UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1`,
          [row.parentId],
        );
        await this.queueThreadUpdates(
          manager,
          effects,
          auth.workspaceId,
          [row.parentId],
          scope.audience,
        );
      }
      const message = await this.loadMessage(row.id, manager);
      effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
      effects.push(() => this.publishRoomsChanged(auth.workspaceId, scope.audience));
      return message;
    });
  }

  /** Author of the root, room owner, workspace owner/admin. Titles an untitled thread too. */
  async renameThread(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    title: string,
  ): Promise<Message> {
    const clean = title?.trim();
    if (!clean || clean.length > THREAD_NAME_MAX) {
      throw new BadRequestException({ message: 'chat.THREAD_TITLE_INVALID' });
    }
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const scope = await this.resolveRoom(manager, auth, roomId);
      const root = await this.requireMessage(manager, scope.room, rootId);
      if (root.parentId || root.deletedAt) {
        throw new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id: rootId } });
      }
      const own = root.authorKind === 'human' && root.authorMemberId === auth.memberId;
      if (!own && scope.role !== 'owner' && !isAdmin(auth)) {
        throw new ForbiddenException({ message: 'chat.FORBIDDEN' });
      }
      await manager.update(ChatMessage, { id: root.id }, { threadTitle: clean });
      const message = await this.loadMessage(root.id, manager);
      effects.push(() => this.publishMessage(auth.workspaceId, message, scope.audience));
      await this.queueThreadUpdates(manager, effects, auth.workspaceId, [root.id], scope.audience);
      effects.push(() => this.publishRoomsChanged(auth.workspaceId, scope.audience));
      return message;
    });
  }

  /** A reply whose thread root is soft-deleted. */
  private async rootDeleted(manager: EntityManager, row: ChatMessage): Promise<boolean> {
    if (!row.parentId) return false;
    const root = await manager.findOneBy(ChatMessage, { id: row.parentId });
    return !root || root.deletedAt != null;
  }

  /** An agent reply that this member requested (their message woke the agent). */
  private async requestedBy(
    manager: EntityManager,
    row: ChatMessage,
    memberId: string,
  ): Promise<boolean> {
    if (row.authorKind !== 'agent' || !row.assignmentId) return false;
    const assignment = await manager.findOneBy(Assignment, { id: row.assignmentId });
    return assignment?.requestedByMemberId === memberId;
  }

  private async requireMessage(
    manager: EntityManager,
    room: Room,
    id: string,
  ): Promise<ChatMessage> {
    const row = isUUID(id) ? await manager.findOneBy(ChatMessage, { id, roomId: room.id }) : null;
    if (!row) throw new NotFoundException({ message: 'chat.MESSAGE_NOT_FOUND', args: { id } });
    return row;
  }

  private emitReplyRequested(workspaceId: string, assignmentId: string): void {
    const payload: ChatReplyRequestedPayload = { workspaceId, assignmentId };
    this.emitter.emit(CHAT_REPLY_REQUESTED_EVENT, payload);
  }
}

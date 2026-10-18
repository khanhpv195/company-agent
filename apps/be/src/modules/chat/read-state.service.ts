import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { MuteState, ReadState, Thread as ThreadContract, ThreadFilter } from '@repo/shared';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { returnedRows, transactionWithEffects } from '../../common/utils';
import { EventsService } from '../events';
import { toThread, type LastMessage } from './chat.mapper';
import { previewOf } from './chat.util';
import { ChatMessage } from './entities/chat-message.entity';
import { MessageStore } from './message-store.service';
import { accessibleRoomIds } from './room-access';

/** Counts of one room's main timeline for one member. */
export interface RoomFacet {
  unread: number;
  mentions: number;
  lastReadSeq: number;
  muted: boolean;
}

/** Counts of one thread (the root and its replies) for one member. */
export interface ThreadFacet extends RoomFacet {
  /** Seq of the thread's last live message. */
  lastSeq: number;
}

const MENTIONS_ME = `EXISTS (SELECT 1 FROM message_mentions mm
       WHERE mm.message_id = m.id AND (mm.member_id = $2 OR mm.kind = 'here'))`;
/** Counts stop here (the FE shows "99+"), so a huge backlog never makes `GET /rooms` scan it all. */
export const COUNT_CAP = 100;
const NOT_MINE = `NOT (m.author_kind = 'human' AND m.author_member_id = $2)`;

/**
 * Read state by message `seq`: a cursor per room (`room_reads`, the main timeline) and per
 * thread (`thread_reads`, keyed by the root message id). Unread = live messages of others after
 * the cursor; mentions = the ones that mention the member (or `@here` / `@room`). Mutes only
 * flag the counts (`muted`), they never hide them. Read, unread and mute changes answer only the
 * member themself (`read.updated`, `rooms.changed`).
 */
@Injectable()
export class ReadStateService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly store: MessageStore,
  ) {}

  // ---------- facets ----------

  async roomFacets(
    manager: EntityManager,
    memberId: string,
    roomIds: string[],
  ): Promise<Map<string, RoomFacet>> {
    const result = new Map<string, RoomFacet>();
    if (!roomIds.length) return result;
    const rows = returnedRows<{
      room_id: string;
      last_read_seq: string;
      muted: boolean;
      unread: string;
      mentions: string;
    }>(
      await manager.query(
        `SELECT r.id AS room_id,
                coalesce(rr.last_read_seq, 0) AS last_read_seq,
                (mu.member_id IS NOT NULL) AS muted,
                coalesce(c.unread, 0) AS unread,
                coalesce(c.mentions, 0) AS mentions
         FROM rooms r
         LEFT JOIN room_reads rr ON rr.room_id = r.id AND rr.member_id = $2
         LEFT JOIN room_mutes mu ON mu.room_id = r.id AND mu.member_id = $2
         LEFT JOIN LATERAL (
           SELECT
             (SELECT count(*) FROM (
                SELECT 1 FROM messages m
                WHERE m.room_id = r.id AND m.parent_id IS NULL AND m.deleted_at IS NULL
                  AND NOT m.system_root AND m.seq > coalesce(rr.last_read_seq, 0)
                  AND ${NOT_MINE} LIMIT ${COUNT_CAP}) u) AS unread,
             (SELECT count(*) FROM (
                SELECT 1 FROM messages m
                WHERE m.room_id = r.id AND m.parent_id IS NULL AND m.deleted_at IS NULL
                  AND NOT m.system_root AND m.seq > coalesce(rr.last_read_seq, 0)
                  AND ${NOT_MINE} AND ${MENTIONS_ME} LIMIT ${COUNT_CAP}) u) AS mentions
         ) c ON true
         WHERE r.id = ANY($1::uuid[])`,
        [roomIds, memberId],
      ),
    );
    for (const row of rows) {
      result.set(row.room_id, {
        unread: Number(row.unread),
        mentions: Number(row.mentions),
        lastReadSeq: Number(row.last_read_seq),
        muted: row.muted,
      });
    }
    return result;
  }

  async threadFacets(
    manager: EntityManager,
    memberId: string,
    rootIds: string[],
  ): Promise<Map<string, ThreadFacet>> {
    const result = new Map<string, ThreadFacet>();
    if (!rootIds.length) return result;
    // A thread the member never opened counts only what came after they joined the room.
    const rows = returnedRows<{
      root_id: string;
      cursor: string;
      muted: boolean;
      unread: string;
      mentions: string;
      last_seq: string | null;
    }>(
      await manager.query(
        `SELECT root.id AS root_id,
                coalesce(tr.last_read_seq, rr.joined_seq, 0) AS cursor,
                (tm.member_id IS NOT NULL) AS muted,
                coalesce(c.unread, 0) AS unread,
                coalesce(c.mentions, 0) AS mentions,
                c.last_seq
         FROM messages root
         LEFT JOIN thread_reads tr ON tr.chat_id = root.id AND tr.member_id = $2
         LEFT JOIN room_reads rr ON rr.room_id = root.room_id AND rr.member_id = $2
         LEFT JOIN thread_mutes tm ON tm.root_id = root.id AND tm.member_id = $2
         LEFT JOIN LATERAL (
           SELECT
             (SELECT count(*) FROM (
                SELECT 1 FROM messages m
                WHERE (m.id = root.id OR m.parent_id = root.id)
                  AND m.deleted_at IS NULL AND NOT m.system_root
                  AND m.seq > coalesce(tr.last_read_seq, rr.joined_seq, 0)
                  AND ${NOT_MINE} LIMIT ${COUNT_CAP}) u) AS unread,
             (SELECT count(*) FROM (
                SELECT 1 FROM messages m
                WHERE (m.id = root.id OR m.parent_id = root.id)
                  AND m.deleted_at IS NULL AND NOT m.system_root
                  AND m.seq > coalesce(tr.last_read_seq, rr.joined_seq, 0)
                  AND ${NOT_MINE} AND ${MENTIONS_ME} LIMIT ${COUNT_CAP}) u) AS mentions,
             (SELECT max(m.seq) FROM messages m
                WHERE (m.id = root.id OR m.parent_id = root.id)
                  AND m.deleted_at IS NULL AND NOT m.system_root) AS last_seq
         ) c ON true
         WHERE root.id = ANY($1::uuid[])`,
        [rootIds, memberId],
      ),
    );
    for (const row of rows) {
      result.set(row.root_id, {
        unread: Number(row.unread),
        mentions: Number(row.mentions),
        lastReadSeq: Number(row.cursor),
        muted: row.muted,
        lastSeq: Number(row.last_seq ?? 0),
      });
    }
    return result;
  }

  /** Per room: the agents whose reply is being written (their run is running) right now. */
  async workingAgents(manager: EntityManager, roomIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!roomIds.length) return result;
    const rows = returnedRows<{ room_id: string; agent_id: string }>(
      await manager.query(
        `SELECT DISTINCT m.room_id, m.author_agent_id AS agent_id
         FROM messages m JOIN assignments a ON a.id = m.assignment_id
         WHERE m.room_id = ANY($1::uuid[]) AND m.status = 'streaming' AND m.deleted_at IS NULL
           AND m.author_agent_id IS NOT NULL AND a.status = 'running'
         ORDER BY m.room_id, m.author_agent_id`,
        [roomIds],
      ),
    );
    for (const row of rows) {
      const list = result.get(row.room_id) ?? [];
      list.push(row.agent_id);
      result.set(row.room_id, list);
    }
    return result;
  }

  // ---------- thread summaries ----------

  /**
   * The thread entries of the sidebar and the thread list, in the order of `roots`: name,
   * preview, counts, cursor, mute and participants. A synthetic (migrated) root never counts.
   */
  async threadSummaries(
    manager: EntityManager,
    workspaceId: string,
    memberId: string,
    roots: ChatMessage[],
    connectionByRoom: Map<string, string | null>,
  ): Promise<ThreadContract[]> {
    if (!roots.length) return [];
    const rootIds = roots.map((root) => root.id);
    const lastByRoot = new Map<string, LastMessage & { seq: number }>();
    for (const row of returnedRows<{
      chat_id: string;
      markdown: string;
      created_at: Date;
      seq: string;
    }>(
      await manager.query(
        `SELECT DISTINCT ON (chat_id) chat_id, markdown, created_at, seq
         FROM (
           SELECT coalesce(parent_id, id) AS chat_id, markdown, created_at, seq, parent_id
           FROM messages
           WHERE workspace_id = $1 AND deleted_at IS NULL AND NOT system_root
             AND (id = ANY($2::uuid[]) OR parent_id = ANY($2::uuid[]))
         ) t
         ORDER BY chat_id, seq DESC, (parent_id IS NOT NULL) DESC`,
        [workspaceId, rootIds],
      ),
    )) {
      lastByRoot.set(row.chat_id, {
        markdown: row.markdown,
        createdAt: row.created_at,
        seq: Number(row.seq),
      });
    }
    const facets = await this.threadFacets(manager, memberId, rootIds);
    const participants = await this.store.participantsOf(manager, roots);
    return roots.map((root) => {
      const facet = facets.get(root.id);
      return toThread(
        root,
        lastByRoot.get(root.id),
        facet?.unread ?? 0,
        previewOf,
        connectionByRoom.get(root.roomId) ?? null,
        {
          mentions: facet?.mentions ?? 0,
          lastReadSeq: facet?.lastReadSeq ?? 0,
          lastSeq: facet?.lastSeq ?? lastByRoot.get(root.id)?.seq ?? 0,
          muted: facet?.muted ?? false,
          replyCount: root.replyCount,
          lastReplyAt: root.lastReplyAt ? root.lastReplyAt.toISOString() : null,
          participantIds: participants.get(root.id) ?? [],
        },
      );
    });
  }

  /**
   * `GET /rooms/:id/threads`: the threads of a room (roots with a title or replies), most
   * recently active first. `unread` / `mentioned` keep those with counts, `mine` those the
   * caller wrote in or was mentioned in.
   */
  async listThreads(
    auth: AuthContext,
    roomId: string,
    filter: ThreadFilter,
    limit: number,
  ): Promise<ThreadContract[]> {
    const manager = this.dataSource.manager;
    const scope = await this.store.resolveRoom(manager, auth, roomId);
    const roots = await manager
      .createQueryBuilder(ChatMessage, 'm')
      .where('m.room_id = :roomId AND m.parent_id IS NULL AND m.deleted_at IS NULL', {
        roomId: scope.room.id,
      })
      .andWhere('(m.thread_title IS NOT NULL OR m.reply_count > 0)')
      .orderBy('m.seq', 'ASC')
      .addOrderBy('m.createdAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getMany();
    const summaries = await this.threadSummaries(
      manager,
      auth.workspaceId,
      auth.memberId,
      roots,
      new Map(roots.map((root) => [root.id, scope.room.connectionId])),
    );
    let mine = new Set<string>();
    if (filter === 'mine' && roots.length) {
      mine = new Set(
        returnedRows<{ root_id: string }>(
          await manager.query(
            `SELECT DISTINCT coalesce(m.parent_id, m.id) AS root_id
             FROM messages m
             WHERE (m.id = ANY($1::uuid[]) OR m.parent_id = ANY($1::uuid[]))
               AND m.deleted_at IS NULL AND NOT m.system_root
               AND ((m.author_kind = 'human' AND m.author_member_id = $2) OR ${MENTIONS_ME})`,
            [roots.map((root) => root.id), auth.memberId],
          ),
        ).map((row) => row.root_id),
      );
    }
    return summaries
      .filter((thread) => {
        if (filter === 'unread') return (thread.unread ?? 0) > 0;
        if (filter === 'mentioned') return (thread.mentions ?? 0) > 0;
        if (filter === 'mine') return mine.has(thread.id);
        return true;
      })
      .sort((a, b) => (b.lastSeq ?? 0) - (a.lastSeq ?? 0) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  // ---------- cursors ----------

  private async roomMaxSeq(manager: EntityManager, roomId: string): Promise<number> {
    const rows = returnedRows<{ max: string | null }>(
      await manager.query(`SELECT max(seq) AS max FROM messages WHERE room_id = $1`, [roomId]),
    );
    return Number(rows[0]?.max ?? 0);
  }

  private async threadMaxSeq(manager: EntityManager, rootId: string): Promise<number> {
    const rows = returnedRows<{ max: string | null }>(
      await manager.query(`SELECT max(seq) AS max FROM messages WHERE id = $1 OR parent_id = $1`, [
        rootId,
      ]),
    );
    return Number(rows[0]?.max ?? 0);
  }

  /** Sets a room cursor: never backwards unless `exact` (mark unread). */
  private async setRoomCursor(
    manager: EntityManager,
    memberId: string,
    roomId: string,
    seq: number,
    exact: boolean,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO room_reads (member_id, room_id, last_read_seq, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, room_id) DO UPDATE
       SET last_read_seq = ${exact ? 'EXCLUDED.last_read_seq' : 'greatest(room_reads.last_read_seq, EXCLUDED.last_read_seq)'},
           updated_at = EXCLUDED.updated_at`,
      [memberId, roomId, seq, this.clock.now()],
    );
  }

  private async setThreadCursor(
    manager: EntityManager,
    memberId: string,
    rootId: string,
    seq: number,
    exact: boolean,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO thread_reads (member_id, chat_id, last_read_seq, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, chat_id) DO UPDATE
       SET last_read_seq = ${exact ? 'EXCLUDED.last_read_seq' : 'greatest(thread_reads.last_read_seq, EXCLUDED.last_read_seq)'},
           updated_at = EXCLUDED.updated_at`,
      [memberId, rootId, seq, this.clock.now()],
    );
  }

  private async roomState(
    manager: EntityManager,
    memberId: string,
    roomId: string,
  ): Promise<ReadState> {
    const facet = (await this.roomFacets(manager, memberId, [roomId])).get(roomId);
    return {
      roomId,
      rootId: null,
      lastReadSeq: facet?.lastReadSeq ?? 0,
      unread: facet?.unread ?? 0,
      mentions: facet?.mentions ?? 0,
    };
  }

  private async threadState(
    manager: EntityManager,
    memberId: string,
    roomId: string,
    rootId: string,
  ): Promise<ReadState> {
    const facet = (await this.threadFacets(manager, memberId, [rootId])).get(rootId);
    return {
      roomId,
      rootId,
      lastReadSeq: facet?.lastReadSeq ?? 0,
      unread: facet?.unread ?? 0,
      mentions: facet?.mentions ?? 0,
    };
  }

  private announce(auth: AuthContext, state: ReadState): void {
    this.events.publish(
      auth.workspaceId,
      {
        type: 'read.updated',
        roomId: state.roomId,
        rootId: state.rootId,
        lastReadSeq: state.lastReadSeq,
        unread: state.unread,
        mentions: state.mentions,
      },
      { memberIds: [auth.memberId] },
    );
  }

  /** The caller has read the main timeline through `seq` (monotonic; capped at the room's last seq). */
  async markRoomRead(auth: AuthContext, roomId: string, seq: number): Promise<ReadState> {
    return this.moveRoom(auth, roomId, (max) => ({ seq: Math.min(seq, max), exact: false }));
  }

  /** Marks the room unread from `throughSeq` on: the cursor becomes `throughSeq - 1` (may move backwards). */
  async markRoomUnread(auth: AuthContext, roomId: string, throughSeq: number): Promise<ReadState> {
    return this.moveRoom(auth, roomId, (max) => ({
      seq: Math.min(Math.max(throughSeq - 1, 0), max),
      exact: true,
    }));
  }

  async markThreadRead(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    seq: number,
  ): Promise<ReadState> {
    return this.moveThread(auth, roomId, rootId, (max) => ({
      seq: Math.min(seq, max),
      exact: false,
    }));
  }

  async markThreadUnread(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    throughSeq: number,
  ): Promise<ReadState> {
    return this.moveThread(auth, roomId, rootId, (max) => ({
      seq: Math.min(Math.max(throughSeq - 1, 0), max),
      exact: true,
    }));
  }

  private async moveRoom(
    auth: AuthContext,
    roomId: string,
    target: (max: number) => { seq: number; exact: boolean },
  ): Promise<ReadState> {
    const state = await transactionWithEffects(this.dataSource, async (manager) => {
      const scope = await this.store.resolveRoom(manager, auth, roomId);
      const { seq, exact } = target(await this.roomMaxSeq(manager, scope.room.id));
      await this.setRoomCursor(manager, auth.memberId, scope.room.id, seq, exact);
      return this.roomState(manager, auth.memberId, scope.room.id);
    });
    this.announce(auth, state);
    return state;
  }

  private async moveThread(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    target: (max: number) => { seq: number; exact: boolean },
  ): Promise<ReadState> {
    const state = await transactionWithEffects(this.dataSource, async (manager) => {
      const scope = await this.store.resolveRoom(manager, auth, roomId);
      const root = await this.store.resolveRoot(manager, scope.room, rootId);
      const { seq, exact } = target(await this.threadMaxSeq(manager, root.id));
      await this.setThreadCursor(manager, auth.memberId, root.id, seq, exact);
      return this.threadState(manager, auth.memberId, scope.room.id, root.id);
    });
    this.announce(auth, state);
    return state;
  }

  /** Reads everything the caller can see: every room's main timeline and every thread. */
  async readAll(auth: AuthContext): Promise<null> {
    await this.dataSource.transaction(async (manager) => {
      const roomIds = await accessibleRoomIds(manager, auth.workspaceId, auth.memberId);
      if (!roomIds.length) return;
      const now = this.clock.now();
      await manager.query(
        `INSERT INTO room_reads (member_id, room_id, last_read_seq, updated_at)
         SELECT $1, r.id, coalesce(max(m.seq), 0), $3
         FROM rooms r LEFT JOIN messages m ON m.room_id = r.id
         WHERE r.id = ANY($2::uuid[])
         GROUP BY r.id
         ON CONFLICT (member_id, room_id) DO UPDATE
         SET last_read_seq = greatest(room_reads.last_read_seq, EXCLUDED.last_read_seq),
             updated_at = EXCLUDED.updated_at`,
        [auth.memberId, roomIds, now],
      );
      await manager.query(
        `INSERT INTO thread_reads (member_id, chat_id, last_read_seq, updated_at)
         SELECT $1, root.id, max(m.seq), $3
         FROM messages root
         JOIN messages m ON m.id = root.id OR m.parent_id = root.id
         WHERE root.room_id = ANY($2::uuid[]) AND root.parent_id IS NULL
           AND (root.thread_title IS NOT NULL OR root.reply_count > 0)
         GROUP BY root.id
         ON CONFLICT (member_id, chat_id) DO UPDATE
         SET last_read_seq = greatest(thread_reads.last_read_seq, EXCLUDED.last_read_seq),
             updated_at = EXCLUDED.updated_at`,
        [auth.memberId, roomIds, now],
      );
    });
    this.events.publish(
      auth.workspaceId,
      { type: 'rooms.changed' },
      { memberIds: [auth.memberId] },
    );
    return null;
  }

  /** Legacy `POST /chats/:id/read`: a DM room or a thread root, read through its last message. */
  async advanceLegacyChat(
    manager: EntityManager,
    memberId: string,
    chat: { kind: 'dm' | 'thread'; id: string; roomId: string },
  ): Promise<void> {
    if (chat.kind === 'dm') {
      await this.setRoomCursor(
        manager,
        memberId,
        chat.roomId,
        await this.roomMaxSeq(manager, chat.roomId),
        false,
      );
    } else {
      await this.setThreadCursor(
        manager,
        memberId,
        chat.id,
        await this.threadMaxSeq(manager, chat.id),
        false,
      );
    }
  }

  // ---------- mutes ----------

  async muteRoom(auth: AuthContext, roomId: string, muted: boolean): Promise<MuteState> {
    const id = await transactionWithEffects(this.dataSource, async (manager) => {
      const scope = await this.store.resolveRoom(manager, auth, roomId);
      await this.setMute(manager, 'room_mutes', 'room_id', auth.memberId, scope.room.id, muted);
      return scope.room.id;
    });
    this.events.publish(
      auth.workspaceId,
      { type: 'rooms.changed' },
      { memberIds: [auth.memberId] },
    );
    return { roomId: id, rootId: null, muted };
  }

  async muteThread(
    auth: AuthContext,
    roomId: string,
    rootId: string,
    muted: boolean,
  ): Promise<MuteState> {
    const ids = await transactionWithEffects(this.dataSource, async (manager) => {
      const scope = await this.store.resolveRoom(manager, auth, roomId);
      const root = await this.store.resolveRoot(manager, scope.room, rootId);
      await this.setMute(manager, 'thread_mutes', 'root_id', auth.memberId, root.id, muted);
      return { roomId: scope.room.id, rootId: root.id };
    });
    this.events.publish(
      auth.workspaceId,
      { type: 'rooms.changed' },
      { memberIds: [auth.memberId] },
    );
    return { ...ids, muted };
  }

  private async setMute(
    manager: EntityManager,
    table: 'room_mutes' | 'thread_mutes',
    column: 'room_id' | 'root_id',
    memberId: string,
    targetId: string,
    muted: boolean,
  ): Promise<void> {
    if (muted) {
      await manager.query(
        `INSERT INTO ${table} (member_id, ${column}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [memberId, targetId],
      );
    } else {
      await manager.query(`DELETE FROM ${table} WHERE member_id = $1 AND ${column} = $2`, [
        memberId,
        targetId,
      ]);
    }
  }
}

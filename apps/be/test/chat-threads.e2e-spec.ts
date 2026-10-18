import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, Chat, Message, Room, RoomTimelinePage, ThreadPage } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../src/common/types';
import { RoomTimelines1792258712308 } from '../src/database/migrations/1792258712308-RoomTimelines';
import { SYSTEM_ROOT_BACKFILL } from '../src/database/migrations/1792260194218-SystemRootMarker';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { ChatService } from '../src/modules/chat/chat.service';
import { ChatMessage } from '../src/modules/chat/entities/chat-message.entity';
import { MessageStore } from '../src/modules/chat/message-store.service';
import { AssignmentBriefService } from '../src/modules/daemon/assignment-brief.service';
import { REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  truncateAll,
} from './utils';

type Verb = 'get' | 'post' | 'patch' | 'delete';
const NIL = '00000000-0000-0000-0000-000000000000';

describe('Room timelines and threads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;

  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let alice: LoggedInClient;
  let bob: LoggedInClient;
  let outsider: LoggedInClient;
  let computerId: string;
  let alpha: Agent;
  let beta: Agent;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
    await setPlan(dataSource, owner.workspaceId, 'team');
    admin = await addMemberWithRole(dataSource, owner, 'admin');
    alice = await addMemberWithRole(dataSource, owner, 'member');
    bob = await addMemberWithRole(dataSource, owner, 'member');
    outsider = await registerAndLogin(app);
    computerId = (await createComputer(dataSource, owner.workspaceId)).id;
    alpha = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Alpha' });
    beta = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Beta' });
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (event: RealtimeEnvelope) => realtime.push(event));
  });

  // ---------- helpers ----------
  const raw = (verb: Verb, path: string, client: LoggedInClient, body?: object) =>
    request(app.getHttpServer())[verb](`/api/v1${path}`).set(client.bearer).send(body);
  const call = async <T>(
    verb: Verb,
    path: string,
    client: LoggedInClient,
    body?: object,
    expected = 200,
  ): Promise<T> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const fail = async (
    verb: Verb,
    path: string,
    client: LoggedInClient,
    status: number,
    body?: object,
  ): Promise<string> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(status);
    return (response.body as ApiResponse<null>).message;
  };
  const createRoom = (client: LoggedInClient, body: object) =>
    call<Room>('post', '/rooms', client, body);
  const post = (client: LoggedInClient, roomId: string, body: object, expected = 200) =>
    call<Message>('post', `/rooms/${roomId}/messages`, client, body, expected);
  const timeline = (client: LoggedInClient, roomId: string, query = '') =>
    call<RoomTimelinePage>('get', `/rooms/${roomId}/messages${query}`, client);
  const threadOf = (client: LoggedInClient, roomId: string, rootId: string, query = '') =>
    call<ThreadPage>('get', `/rooms/${roomId}/messages/${rootId}/thread${query}`, client);
  const dmOf = async (client: LoggedInClient, agent: Agent): Promise<string> =>
    (await call<{ chatId: string }>('post', `/agents/${agent.id}/dm`, client)).chatId;
  const assignments = () =>
    dataSource.getRepository(Assignment).find({ order: { createdAt: 'ASC', id: 'ASC' } });
  const assignmentOf = (messageId: string) =>
    dataSource.getRepository(Assignment).findOneByOrFail({ sourceId: messageId });
  const eventsOf = (type: string) => realtime.filter((e) => e.event.type === type);

  /** A public channel: alice owns it, bob and Alpha/Beta belong to it. */
  const teamRoom = (name = 'team', agentIds = [alpha.id, beta.id]) =>
    createRoom(alice, { name, memberIds: [bob.memberId], agentIds });

  // ---------- migration ----------
  describe('migration of the old threads table', () => {
    it('turns threads into root messages with replies, keeps ids, and reverts', async () => {
      const room = await teamRoom('legacy', [alpha.id]);
      const dm = await dmOf(alice, alpha);
      const runner = dataSource.createQueryRunner();
      const migration = new RoomTimelines1792258712308();
      const base = Date.now() - 3_600_000;
      const t1 = randomUUID();
      const t2 = randomUUID();
      const t3 = randomUUID();
      const ids = { a: '', b: '', c: '', d: '', e: '', f: '', g: '' };
      let legacy = false;
      // The follow-up migration: marks the synthetic roots and moves empty-thread roots in place.
      const backfill = async () => {
        for (const sql of SYSTEM_ROOT_BACKFILL) await dataSource.query(sql);
      };
      try {
        await migration.down(runner);
        legacy = true;
        const thread = (id: string, name: string, at: number) =>
          dataSource.query(
            `INSERT INTO threads (id, workspace_id, room_id, name, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [id, owner.workspaceId, room.id, name, new Date(base + at * 1000)],
          );
        const message = async (
          chatId: string,
          kind: 'dm' | 'thread',
          by: 'human' | 'agent',
          who: string,
          text: string,
          at: number,
        ): Promise<string> =>
          (
            (await dataSource.query(
              `INSERT INTO messages (workspace_id, chat_id, chat_kind, author_kind, author_member_id, author_agent_id, status, markdown, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'complete', $7, $8) RETURNING id`,
              [
                owner.workspaceId,
                chatId,
                kind,
                by,
                by === 'human' ? who : null,
                by === 'agent' ? who : null,
                text,
                new Date(base + at * 1000),
              ],
            )) as { id: string }[]
          )[0].id;
        await thread(t1, 'Human first', 1);
        await thread(t2, 'Agent first', 2);
        await thread(t3, 'Empty', 11.5);
        ids.a = await message(t1, 'thread', 'human', alice.memberId, 'Where is it?', 10);
        ids.b = await message(t1, 'thread', 'agent', alpha.id, 'Over there', 11);
        ids.c = await message(t1, 'thread', 'human', bob.memberId, 'thanks', 12);
        ids.d = await message(t2, 'thread', 'agent', alpha.id, 'Heads up', 13);
        ids.e = await message(t2, 'thread', 'human', alice.memberId, 'ok', 14);
        ids.f = await message(dm, 'dm', 'human', alice.memberId, 'hi', 15);
        ids.g = await message(dm, 'dm', 'agent', alpha.id, 'hello', 16);
        await message(randomUUID(), 'thread', 'human', alice.memberId, 'orphan', 17);
        await migration.up(runner);
        legacy = false;
      } finally {
        if (legacy) await migration.up(runner);
      }
      await backfill();
      // Alice has read the whole first thread (read marks are seq cursors now).
      await dataSource.query(
        `INSERT INTO thread_reads (member_id, chat_id, last_read_seq)
         SELECT $1, $2, max(seq) FROM messages WHERE id = $2 OR parent_id = $2`,
        [alice.memberId, t1],
      );

      const rows = (await dataSource.query(
        `SELECT id, parent_id, room_id, thread_title, reply_count, author_kind, external_name, markdown
         FROM messages ORDER BY seq`,
      )) as {
        id: string;
        parent_id: string | null;
        room_id: string;
        thread_title: string | null;
        reply_count: number;
        author_kind: string;
        external_name: string | null;
        markdown: string;
      }[];
      // 3 + 3 (a synthetic root for "Agent first") + 1 (for "Empty") + 2 DM; the orphan is gone
      expect(rows).toHaveLength(9);
      const byId = new Map(rows.map((row) => [row.id, row]));
      // The first human message is the root and takes the old thread id.
      expect(byId.get(t1)).toMatchObject({
        parent_id: null,
        room_id: room.id,
        thread_title: 'Human first',
        reply_count: 2,
        author_kind: 'human',
        markdown: 'Where is it?',
      });
      expect(byId.has(ids.a)).toBe(false);
      expect(byId.get(ids.b)?.parent_id).toBe(t1);
      expect(byId.get(ids.c)?.parent_id).toBe(t1);
      // An agent speaking first, or nobody: a synthetic root named after the thread.
      expect(byId.get(t2)).toMatchObject({
        parent_id: null,
        thread_title: 'Agent first',
        reply_count: 2,
        author_kind: 'external',
        external_name: 'System',
        markdown: 'Agent first',
      });
      expect(byId.get(ids.d)?.parent_id).toBe(t2);
      expect(byId.get(ids.e)?.parent_id).toBe(t2);
      expect(byId.get(t3)).toMatchObject({ reply_count: 0, markdown: 'Empty' });
      // only the synthetic roots are marked, and the empty one sorts by its creation time
      expect(
        (
          (await dataSource.query(
            `SELECT id FROM messages WHERE system_root ORDER BY created_at`,
          )) as { id: string }[]
        ).map((row) => row.id),
      ).toEqual([t2, t3]);
      expect(byId.get(ids.f)).toMatchObject({ parent_id: null, room_id: dm });
      expect(byId.get(ids.g)).toMatchObject({ parent_id: null, room_id: dm });
      expect(await dataSource.query(`SELECT to_regclass('threads') AS t`)).toEqual([{ t: null }]);

      // Old chat ids keep resolving; the sidebar lists the converted threads.
      const sidebar = (await call<Room[]>('get', '/rooms', bob)).find((r) => r.id === room.id)!;
      expect(sidebar.threads.map((t) => [t.id, t.name])).toEqual([
        [t1, 'Human first'],
        [t3, 'Empty'],
        [t2, 'Agent first'],
      ]);
      expect(sidebar.threads.map((t) => t.unread)).toEqual([2, 0, 2]); // Bob wrote the last reply himself
      expect(
        (await call<Room[]>('get', '/rooms', alice))
          .find((r) => r.id === room.id)!
          .threads.map((t) => t.unread),
      ).toEqual([0, 0, 1]); // old read marks still apply; a synthetic root is never unread
      // a synthetic root is no preview either
      expect(sidebar.threads.map((t) => t.preview)).toEqual(['thanks', 'Empty', 'ok']);
      expect(
        (await call<Message[]>('get', `/chats/${t1}/messages`, alice)).map((m) => m.id),
      ).toEqual([t1, ids.b, ids.c]);
      // the synthetic root shares the seq of the first reply and still comes first
      expect(
        (await call<Message[]>('get', `/chats/${t2}/messages`, alice)).map((m) => m.id),
      ).toEqual([t2, ids.d, ids.e]);
      expect((await call<Chat>('get', `/chats/${t2}`, alice)).title).toBe('Agent first');
      const dmMessages = await call<Message[]>('get', `/chats/${dm}/messages`, alice);
      expect(dmMessages.map((m) => [m.id, m.chatId])).toEqual([
        [ids.f, dm],
        [ids.g, dm],
      ]);
      const main = await timeline(alice, room.id);
      expect(main.messages.map((m) => m.id)).toEqual([t1, t3, t2]);
      expect(main.messages[0].thread).toMatchObject({ title: 'Human first', replyCount: 2 });

      // down rebuilds the old shape (threads keep their ids) and up converts it again.
      try {
        await migration.down(runner);
        legacy = true;
        expect(
          ((await dataSource.query(`SELECT id FROM threads`)) as { id: string }[])
            .map((row) => row.id)
            .sort(),
        ).toEqual([t1, t2, t3].sort());
        expect(
          await dataSource.query(`SELECT count(*)::int AS n FROM messages WHERE chat_id = $1`, [
            t1,
          ]),
        ).toEqual([{ n: 3 }]);
        expect(
          await dataSource.query(`SELECT count(*)::int AS n FROM messages WHERE chat_kind = 'dm'`),
        ).toEqual([{ n: 2 }]);
        await migration.up(runner);
        legacy = false;
      } finally {
        if (legacy) await migration.up(runner);
        await runner.release();
      }
      await backfill();
      expect((await timeline(alice, room.id)).messages.map((m) => m.id)).toEqual([t1, t3, t2]);
    });
  });

  // ---------- timeline and thread reads ----------
  describe('GET /rooms/:id/messages', () => {
    it('pages the main timeline oldest-first within a page', async () => {
      const room = await teamRoom();
      const sent: Message[] = [];
      for (let i = 1; i <= 7; i++) sent.push(await post(alice, room.id, { markdown: `m${i}` }));

      const page1 = await timeline(bob, room.id, '?limit=3');
      expect(page1.messages.map((m) => m.markdown)).toEqual(['m5', 'm6', 'm7']);
      expect(page1.hasMore).toBe(true);
      expect(page1.messages[0]).toMatchObject({
        roomId: room.id,
        parentId: null,
        author: { kind: 'human', id: alice.memberId },
      });
      const page2 = await timeline(bob, room.id, `?limit=3&beforeSeq=${page1.messages[0].seq}`);
      expect(page2.messages.map((m) => m.markdown)).toEqual(['m2', 'm3', 'm4']);
      expect(page2.hasMore).toBe(true);
      const page3 = await timeline(bob, room.id, `?limit=3&beforeSeq=${page2.messages[0].seq}`);
      expect(page3.messages.map((m) => m.markdown)).toEqual(['m1']);
      expect(page3.hasMore).toBe(false);
      // default page size, and exactly-full pages report no more
      expect((await timeline(bob, room.id)).messages).toHaveLength(7);
      expect((await timeline(bob, room.id, '?limit=7')).hasMore).toBe(false);

      await fail('get', `/rooms/${room.id}/messages?limit=101`, bob, 400);
      await fail('get', `/rooms/${room.id}/messages?limit=0`, bob, 400);
      await fail('get', `/rooms/${room.id}/messages?beforeSeq=abc`, bob, 400);
    });

    it('shows threads as roots with a summary, and keeps replies off the main timeline', async () => {
      const room = await teamRoom();
      const plain = await post(alice, room.id, { markdown: 'just a message' });
      expect(plain.thread).toBeUndefined();
      const root = await post(alice, room.id, {
        markdown: 'Plan the release',
        threadTitle: ' Release ',
      });
      expect(root).toMatchObject({ threadTitle: 'Release', parentId: null });
      const r1 = await post(bob, room.id, { markdown: 'on it', parentId: root.id });
      const r2 = await post(alice, room.id, { markdown: 'thanks', parentId: root.id });

      const main = await timeline(alice, room.id);
      expect(main.messages.map((m) => m.id)).toEqual([plain.id, root.id]);
      expect(main.messages[1].thread).toEqual({
        title: 'Release',
        replyCount: 2,
        lastReplyAt: expect.any(String),
        participantIds: [alice.memberId, bob.memberId],
      });
      expect(main.messages[1].thread!.lastReplyAt).toBe(r2.createdAt);

      const thread = await threadOf(bob, room.id, root.id);
      expect(thread.root).toMatchObject({ id: root.id, markdown: 'Plan the release' });
      expect(thread.replies.map((m) => m.id)).toEqual([r1.id, r2.id]);
      expect(thread.replies[0]).toMatchObject({ parentId: root.id, chatId: root.id });
      expect(thread.hasMore).toBe(false);
      const first = await threadOf(bob, room.id, root.id, '?limit=1');
      expect(first.replies.map((m) => m.id)).toEqual([r1.id]);
      expect(first.hasMore).toBe(true);
      const rest = await threadOf(bob, room.id, root.id, `?afterSeq=${r1.seq}&limit=1`);
      expect(rest.replies.map((m) => m.id)).toEqual([r2.id]);
      expect(rest.hasMore).toBe(false);
      // a reply id opens the thread of its root; a plain message is a thread of nothing yet
      expect((await threadOf(bob, room.id, r1.id)).root.id).toBe(root.id);
      expect((await threadOf(bob, room.id, plain.id)).replies).toEqual([]);
      await fail('get', `/rooms/${room.id}/messages/${NIL}/thread`, bob, 404);
      await fail('get', `/rooms/${room.id}/messages/nope/thread`, bob, 404);
    });

    it('tracks counters in the same transaction and announces thread.updated', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'Topic' });
      realtime = [];
      const reply = await post(bob, room.id, { markdown: 'a reply', parentId: root.id });
      const rows = await dataSource.getRepository(ChatMessage).findOneByOrFail({ id: root.id });
      expect(rows.replyCount).toBe(1);
      expect(rows.lastReplyAt?.toISOString()).toBe(reply.createdAt);
      const updates = eventsOf('thread.updated');
      expect(updates).toHaveLength(1);
      expect(updates[0].event).toEqual({
        type: 'thread.updated',
        roomId: room.id,
        rootId: root.id,
        title: 'Topic',
        replyCount: 1,
        lastReplyAt: reply.createdAt,
      });
      const upserted = eventsOf('message.upserted');
      expect(upserted).toHaveLength(1);
      expect(upserted[0].event).toMatchObject({
        message: { id: reply.id, roomId: room.id, parentId: root.id },
      });
    });
  });

  // ---------- sending ----------
  describe('POST /rooms/:id/messages', () => {
    it('validates the input', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root' });
      await fail('post', `/rooms/${room.id}/messages`, alice, 400, { markdown: '   ' });
      await fail('post', `/rooms/${room.id}/messages`, alice, 400, {
        markdown: 'x'.repeat(20_001),
      });
      expect(
        await fail('post', `/rooms/${room.id}/messages`, alice, 400, {
          markdown: 'hi',
          parentId: root.id,
          threadTitle: 'No',
        }),
      ).toBe('A thread title is only allowed on a new root message');
      await fail('post', `/rooms/${room.id}/messages`, alice, 400, {
        markdown: 'hi',
        threadTitle: 'x'.repeat(121),
      });
      await fail('post', `/rooms/${room.id}/messages`, alice, 400, {
        markdown: 'hi',
        threadTitle: '  ',
      });
      await fail('post', `/rooms/${room.id}/messages`, alice, 404, {
        markdown: 'hi',
        parentId: NIL,
      });
      await fail('post', `/rooms/${room.id}/messages`, alice, 404, {
        markdown: 'hi',
        parentId: 'nope',
      });
      // a parent of another room is not found
      const other = await teamRoom('other');
      const foreign = await post(alice, other.id, { markdown: 'elsewhere' });
      await fail('post', `/rooms/${room.id}/messages`, alice, 404, {
        markdown: 'hi',
        parentId: foreign.id,
      });
      // a quote must be a message of the same room
      await fail('post', `/rooms/${room.id}/messages`, alice, 400, {
        markdown: 'hi',
        quoteMessageId: foreign.id,
      });
      await fail('post', `/rooms/${NIL}/messages`, alice, 404, { markdown: 'hi' });
    });

    it('attaches a reply to a reply to its root, and carries quotes', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root' });
      const reply = await post(bob, room.id, { markdown: 'first reply', parentId: root.id });
      const nested = await post(alice, room.id, {
        markdown: 'reply to the reply',
        parentId: reply.id,
        quoteMessageId: reply.id,
      });
      expect(nested.parentId).toBe(root.id);
      expect(nested.quote).toEqual({
        id: reply.id,
        authorName: expect.any(String),
        excerpt: 'first reply',
      });
      expect(
        (await dataSource.getRepository(ChatMessage).findOneByOrFail({ id: root.id })).replyCount,
      ).toBe(2);
      // the quoted text disappears with the message
      await call('delete', `/rooms/${room.id}/messages/${reply.id}`, bob);
      const after = await threadOf(alice, room.id, root.id);
      expect(after.replies.find((m) => m.id === nested.id)?.quote).toEqual({
        id: reply.id,
        authorName: expect.any(String),
        excerpt: '',
      });
    });

    it('is idempotent per (room, author, clientMessageId)', async () => {
      const room = await teamRoom();
      const first = await post(alice, room.id, { markdown: 'once', clientMessageId: 'c-1' });
      expect(first.clientMessageId).toBe('c-1');
      const again = await post(alice, room.id, {
        markdown: 'once (retry)',
        clientMessageId: 'c-1',
      });
      expect(again.id).toBe(first.id);
      expect(again.markdown).toBe('once');
      // another author or another room may reuse the key
      const bobs = await post(bob, room.id, { markdown: 'bob', clientMessageId: 'c-1' });
      expect(bobs.id).not.toBe(first.id);
      const other = await teamRoom('elsewhere');
      expect((await post(alice, other.id, { markdown: 'x', clientMessageId: 'c-1' })).id).not.toBe(
        first.id,
      );
      // concurrent retries store one message
      const burst = await Promise.all(
        [1, 2, 3, 4].map(() => post(alice, room.id, { markdown: 'burst', clientMessageId: 'c-2' })),
      );
      expect(new Set(burst.map((m) => m.id)).size).toBe(1);
      expect(
        await dataSource.getRepository(ChatMessage).count({
          where: { roomId: room.id, clientMessageId: 'c-2' },
        }),
      ).toBe(1);
      // a retried send does not wake the agent twice
      await post(alice, room.id, { markdown: '@Alpha go', clientMessageId: 'c-3' });
      await post(alice, room.id, { markdown: '@Alpha go', clientMessageId: 'c-3' });
      expect(await assignments()).toHaveLength(1);
    });

    it('lets members of the room write, and nobody else', async () => {
      const room = await teamRoom();
      await post(bob, room.id, { markdown: 'member of the room' });
      await fail('post', `/rooms/${room.id}/messages`, outsider, 404, { markdown: 'no' });
      // a public room still needs membership to write or read
      const joiner = await addMemberWithRole(dataSource, owner, 'member');
      await fail('post', `/rooms/${room.id}/messages`, joiner, 404, { markdown: 'no' });
      await fail('get', `/rooms/${room.id}/messages`, joiner, 404);
      await call('post', `/rooms/${room.id}/join`, joiner);
      await post(joiner, room.id, { markdown: 'now yes' });
    });
  });

  // ---------- agents ----------
  describe('agent replies', () => {
    it('answers a main-timeline channel mention under the trigger message (a thread reply)', async () => {
      const room = await teamRoom();
      const trigger = await post(alice, room.id, { markdown: '@Alpha please look' });
      const main = await timeline(bob, room.id);
      // the reply is not on the main timeline; the trigger became a thread root
      expect(main.messages.map((m) => m.id)).toEqual([trigger.id]);
      expect(main.messages[0].thread).toMatchObject({ title: null, replyCount: 1 });
      const thread = await threadOf(bob, room.id, trigger.id);
      expect(thread.replies).toHaveLength(1);
      expect(thread.replies[0]).toMatchObject({
        parentId: trigger.id,
        roomId: room.id,
        chatId: trigger.id,
        author: { kind: 'agent', id: alpha.id },
        status: 'streaming',
      });
      expect(thread.replies[0].assignment).toMatchObject({ agentId: alpha.id, status: 'offered' });
      const [run] = await assignments();
      expect(run).toMatchObject({ agentId: alpha.id, sourceKind: 'chat' });
      expect(run.sourceId).toBe(thread.replies[0].id);
    });

    it('answers inside the thread a trigger was posted in', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'topic', threadTitle: 'Topic' });
      const trigger = await post(bob, room.id, { markdown: '@Beta your view?', parentId: root.id });
      const nested = await post(bob, room.id, {
        markdown: '@Alpha and you?',
        parentId: trigger.id, // a reply id attaches to the root
      });
      const thread = await threadOf(alice, room.id, root.id);
      expect(thread.replies.map((m) => [m.author.kind, m.parentId])).toEqual([
        ['human', root.id],
        ['agent', root.id],
        ['human', root.id],
        ['agent', root.id],
      ]);
      expect(nested.parentId).toBe(root.id);
      expect((await timeline(alice, room.id)).messages.map((m) => m.id)).toEqual([root.id]);
    });

    it('answers a DM in its main timeline, and a DM thread in that thread', async () => {
      const dm = await dmOf(alice, alpha);
      const hi = await post(alice, dm, { markdown: 'hello there' });
      expect(hi).toMatchObject({ roomId: dm, parentId: null, chatId: dm });
      let main = await timeline(alice, dm);
      expect(main.messages.map((m) => [m.author.kind, m.parentId])).toEqual([
        ['human', null],
        ['agent', null],
      ]);
      expect(main.messages[1]).toMatchObject({ chatId: dm, status: 'streaming' });
      // a thread inside the DM
      const inThread = await post(alice, dm, { markdown: 'side topic', parentId: hi.id });
      expect(inThread.parentId).toBe(hi.id);
      main = await timeline(alice, dm);
      expect(main.messages.map((m) => m.id)).toContain(hi.id);
      expect(main.messages).toHaveLength(2);
      const thread = await threadOf(alice, dm, hi.id);
      expect(thread.replies.map((m) => m.author.kind)).toEqual(['human', 'agent']);
      expect(thread.replies[1].parentId).toBe(hi.id);
      // another member's DM is invisible
      await fail('get', `/rooms/${dm}/messages`, bob, 404);
      await fail('post', `/rooms/${dm}/messages`, bob, 404, { markdown: 'psst' });
    });

    it('wakes every mentioned agent in mention order (case-insensitive, at most 3)', async () => {
      const gamma = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Gamma' });
      const delta = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Delta' });
      const room = await teamRoom('wide', [alpha.id, beta.id, gamma.id, delta.id]);
      const trigger = await post(alice, room.id, {
        markdown: '@beta first, then @ALPHA, @Alpha again, @Delta and @gamma',
      });
      const replies = (await threadOf(alice, room.id, trigger.id)).replies;
      expect(replies.map((m) => m.author)).toEqual([
        { kind: 'agent', id: beta.id },
        { kind: 'agent', id: alpha.id },
        { kind: 'agent', id: delta.id },
      ]);
      expect(replies.map((m) => m.assignment!.agentId)).toEqual([beta.id, alpha.id, delta.id]);
      expect(await assignments()).toHaveLength(3);
      expect((await timeline(alice, room.id)).messages[0].thread!.replyCount).toBe(3);

      // an explicit agent comes first
      const second = await post(alice, room.id, { markdown: '@Gamma too', agentId: delta.id });
      expect((await threadOf(alice, room.id, second.id)).replies.map((m) => m.author)).toEqual([
        { kind: 'agent', id: delta.id },
        { kind: 'agent', id: gamma.id },
      ]);
      // an agent that is not in the room is not woken by a mention
      const outsideRoom = await teamRoom('small', [alpha.id]);
      const third = await post(alice, outsideRoom.id, { markdown: '@Beta @Alpha' });
      expect((await threadOf(alice, outsideRoom.id, third.id)).replies).toHaveLength(1);
    });

    it('matches longer agent names first', async () => {
      const bot = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Bot' });
      const pro = await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Bot Pro' });
      const room = await teamRoom('bots', [bot.id, pro.id]);
      const one = await post(alice, room.id, { markdown: '@Bot Pro help' });
      expect((await threadOf(alice, room.id, one.id)).replies.map((m) => m.author)).toEqual([
        { kind: 'agent', id: pro.id },
      ]);
      const both = await post(alice, room.id, { markdown: '@Bot Pro and @Bot' });
      expect((await threadOf(alice, room.id, both.id)).replies.map((m) => m.author)).toEqual([
        { kind: 'agent', id: pro.id },
        { kind: 'agent', id: bot.id },
      ]);
    });

    it('refuses a DM to an agent whose computer is offline (409, nothing stored)', async () => {
      const off = await createComputer(dataSource, owner.workspaceId, {
        name: 'asleep',
        status: 'offline',
      });
      const sleeper = await createAgent(dataSource, owner.workspaceId, off.id, { name: 'Sleeper' });
      const dm = await dmOf(alice, sleeper);
      expect(await fail('post', `/rooms/${dm}/messages`, alice, 409, { markdown: 'wake up' })).toBe(
        "This agent's computer is offline, so it cannot answer right now",
      );
      const vi = await raw('post', `/rooms/${dm}/messages`, alice, { markdown: 'dậy đi' }).set(
        'Accept-Language',
        'vi',
      );
      expect(vi.status).toBe(409);
      expect((vi.body as ApiResponse<null>).message).toBe(
        'Máy của agent này đang offline nên chưa thể trả lời',
      );
      expect((await timeline(alice, dm)).messages).toEqual([]);
      await fail('post', `/chats/${dm}/messages`, alice, 409, { markdown: 'legacy route' });
      expect(await assignments()).toHaveLength(0);
      // once the computer is back the DM works
      await dataSource.query(`UPDATE computers SET status = 'online' WHERE id = $1`, [off.id]);
      await post(alice, dm, { markdown: 'wake up' });
      expect(await assignments()).toHaveLength(1);
    });
  });

  // ---------- edit, delete, rename ----------
  describe('edit, delete and rename', () => {
    it('lets authors edit their own human messages only', async () => {
      const room = await teamRoom();
      const mine = await post(alice, room.id, { markdown: 'draft one' });
      const edited = await call<Message>('patch', `/rooms/${room.id}/messages/${mine.id}`, alice, {
        markdown: ' draft two ',
      });
      expect(edited).toMatchObject({ markdown: 'draft two', editedAt: expect.any(String) });
      expect(mine.editedAt).toBeNull();
      await fail('patch', `/rooms/${room.id}/messages/${mine.id}`, bob, 403, {
        markdown: 'mine now',
      });
      // owners and admins cannot rewrite other people's words either
      await fail('patch', `/rooms/${room.id}/messages/${mine.id}`, owner, 404, { markdown: 'x' });
      await fail('patch', `/rooms/${room.id}/messages/${mine.id}`, alice, 400, { markdown: '  ' });
      await fail('patch', `/rooms/${room.id}/messages/${NIL}`, alice, 404, { markdown: 'x' });
      // an agent reply cannot be edited by a person
      const trigger = await post(alice, room.id, { markdown: '@Alpha hi' });
      const [reply] = (await threadOf(alice, room.id, trigger.id)).replies;
      await fail('patch', `/rooms/${room.id}/messages/${reply.id}`, alice, 403, { markdown: 'x' });
      expect(
        eventsOf('message.upserted').some(
          (e) => e.event.type === 'message.upserted' && e.event.message.editedAt,
        ),
      ).toBe(true);
      // gone messages cannot be edited
      await call('delete', `/rooms/${room.id}/messages/${mine.id}`, alice);
      await fail('patch', `/rooms/${room.id}/messages/${mine.id}`, alice, 404, { markdown: 'x' });
    });

    it('soft-deletes with the right authorization and a placeholder shape', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'T' });
      const bobs = await post(bob, room.id, { markdown: 'bob says', parentId: root.id });
      const alices = await post(alice, room.id, { markdown: 'alice says', parentId: root.id });
      // another member may not delete; the room owner, the author, an admin who is a member may
      await fail('delete', `/rooms/${room.id}/messages/${alices.id}`, bob, 403);
      realtime = [];
      const gone = await call<Message>('delete', `/rooms/${room.id}/messages/${bobs.id}`, alice);
      expect(gone).toMatchObject({ id: bobs.id, deleted: true, markdown: '', quote: null });
      expect(gone.assignment).toBeNull();
      expect(eventsOf('message.upserted')).toHaveLength(1);
      expect(eventsOf('thread.updated')[0].event).toMatchObject({ rootId: root.id, replyCount: 1 });
      // idempotent, and the row keeps no text
      expect(
        (await call<Message>('delete', `/rooms/${room.id}/messages/${bobs.id}`, bob)).deleted,
      ).toBe(true);
      expect(
        (await dataSource.getRepository(ChatMessage).findOneByOrFail({ id: bobs.id })).markdown,
      ).toBe('');
      const thread = await threadOf(alice, room.id, root.id);
      expect(thread.replies.map((m) => [m.id, m.deleted, m.markdown])).toEqual([
        [bobs.id, true, ''],
        [alices.id, false, 'alice says'],
      ]);
      expect((await timeline(alice, room.id)).messages[0].thread!.replyCount).toBe(1);
      // legacy readers simply do not see it
      expect(
        (await call<Message[]>('get', `/chats/${root.id}/messages`, alice)).map((m) => m.id),
      ).toEqual([root.id, alices.id]);

      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [admin.memberId] });
      await call<Message>('delete', `/rooms/${room.id}/messages/${alices.id}`, admin);
      // deleting a root hides its thread
      await call<Message>('delete', `/rooms/${room.id}/messages/${root.id}`, alice);
      await fail('get', `/rooms/${room.id}/messages/${root.id}/thread`, alice, 404);
      await fail('post', `/rooms/${room.id}/messages`, alice, 404, {
        markdown: 'late',
        parentId: root.id,
      });
      const main = await timeline(alice, room.id);
      expect(main.messages).toHaveLength(1);
      expect(main.messages[0]).toMatchObject({ id: root.id, deleted: true, markdown: '' });
      expect(main.messages[0].thread).toBeUndefined();
      await fail('get', `/chats/${root.id}/messages`, alice, 404);
    });

    it('lets owners and admins delete in rooms they can see, nobody outside', async () => {
      const room = await teamRoom();
      const msg = await post(bob, room.id, { markdown: 'bob' });
      // a workspace admin who is not in a (private) room cannot even see it
      const priv = await createRoom(alice, { name: 'secret', isPrivate: true });
      const secret = await post(alice, priv.id, { markdown: 'hidden' });
      await fail('delete', `/rooms/${priv.id}/messages/${secret.id}`, admin, 404);
      await fail('delete', `/rooms/${room.id}/messages/${msg.id}`, outsider, 404);
      // as a member, a workspace admin may delete anybody's message
      await call('post', `/rooms/${priv.id}/members`, alice, { memberIds: [admin.memberId] });
      expect(
        (await call<Message>('delete', `/rooms/${priv.id}/messages/${secret.id}`, admin)).deleted,
      ).toBe(true);
    });

    it('cancels a running agent reply when it is deleted', async () => {
      const room = await teamRoom();
      const trigger = await post(alice, room.id, { markdown: '@Alpha work' });
      const [reply] = (await threadOf(alice, room.id, trigger.id)).replies;
      expect((await assignmentOf(reply.id)).status).toBe('offered');
      const gone = await call<Message>('delete', `/rooms/${room.id}/messages/${reply.id}`, alice);
      expect(gone.deleted).toBe(true);
      expect((await assignmentOf(reply.id)).status).toBe('cancelled');
      // deleting the trigger (a root) cancels the replies under it too
      const second = await post(alice, room.id, { markdown: '@Beta work' });
      const [secondReply] = (await threadOf(alice, room.id, second.id)).replies;
      expect((await assignmentOf(secondReply.id)).status).toBe('offered');
      await call('delete', `/rooms/${room.id}/messages/${second.id}`, alice);
      expect((await assignmentOf(secondReply.id)).status).toBe('cancelled');
    });

    it('renames threads: root author, room owner, workspace admin', async () => {
      const room = await teamRoom();
      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [admin.memberId] });
      const root = await post(bob, room.id, { markdown: 'start', threadTitle: 'Old' });
      realtime = [];
      const renamed = await call<Message>(
        'patch',
        `/rooms/${room.id}/messages/${root.id}/thread`,
        bob,
        { title: '  New name ' },
      );
      expect(renamed).toMatchObject({ id: root.id, threadTitle: 'New name' });
      expect(eventsOf('thread.updated')[0].event).toMatchObject({
        rootId: root.id,
        title: 'New name',
      });
      for (const [client, title] of [
        [alice, 'by the room owner'],
        [admin, 'by an admin'],
      ] as const) {
        expect(
          (
            await call<Message>('patch', `/rooms/${room.id}/messages/${root.id}/thread`, client, {
              title,
            })
          ).threadTitle,
        ).toBe(title);
      }
      const carol = await addMemberWithRole(dataSource, owner, 'member');
      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [carol.memberId] });
      await fail('patch', `/rooms/${room.id}/messages/${root.id}/thread`, carol, 403, {
        title: 'x',
      });
      await fail('patch', `/rooms/${room.id}/messages/${root.id}/thread`, bob, 400, { title: '' });
      await fail('patch', `/rooms/${room.id}/messages/${root.id}/thread`, bob, 400, {
        title: 'x'.repeat(121),
      });
      await fail('patch', `/rooms/${room.id}/messages/${NIL}/thread`, bob, 404, { title: 'x' });
      // an untitled thread (a message with replies) can be titled too
      const trigger = await post(bob, room.id, { markdown: '@Alpha hi' });
      expect(
        (
          await call<Message>('patch', `/rooms/${room.id}/messages/${trigger.id}/thread`, bob, {
            title: 'Alpha chat',
          })
        ).thread,
      ).toMatchObject({ title: 'Alpha chat', replyCount: 1 });
      // the sidebar (legacy) view follows
      const sidebar = (await call<Room[]>('get', '/rooms', bob)).find((r) => r.id === room.id)!;
      expect(sidebar.threads.map((t) => t.name)).toEqual(['by an admin', 'Alpha chat']);
    });
  });

  // ---------- privacy ----------
  describe('privacy', () => {
    it('hides private rooms, their threads and events from non-members', async () => {
      const priv = await createRoom(alice, {
        name: 'war-room',
        isPrivate: true,
        agentIds: [alpha.id],
      });
      realtime = [];
      const root = await post(alice, priv.id, {
        markdown: '@Alpha secret plan',
        threadTitle: 'Plan',
      });
      for (const client of [bob, admin, owner, outsider]) {
        await fail('get', `/rooms/${priv.id}/messages`, client, 404);
        await fail('get', `/rooms/${priv.id}/messages/${root.id}/thread`, client, 404);
        await fail('post', `/rooms/${priv.id}/messages`, client, 404, { markdown: 'hi' });
        await fail('post', `/rooms/${priv.id}/messages`, client, 404, {
          markdown: 'hi',
          parentId: root.id,
        });
        await fail('patch', `/rooms/${priv.id}/messages/${root.id}`, client, 404, {
          markdown: 'x',
        });
        await fail('delete', `/rooms/${priv.id}/messages/${root.id}`, client, 404);
        await fail('patch', `/rooms/${priv.id}/messages/${root.id}/thread`, client, 404, {
          title: 'x',
        });
        await fail('get', `/chats/${root.id}/messages`, client, 404);
      }
      // events only go to the members of the room
      for (const type of ['message.upserted', 'thread.updated', 'rooms.changed']) {
        const frames = eventsOf(type);
        expect(frames.length).toBeGreaterThan(0);
        for (const frame of frames) expect(frame.memberIds).toEqual([alice.memberId]);
      }
      // a public room's events reach its members, not the whole workspace
      realtime = [];
      const pub = await teamRoom('open');
      realtime = [];
      await post(alice, pub.id, { markdown: 'hello', threadTitle: 'Open' });
      for (const type of ['message.upserted', 'thread.updated']) {
        for (const frame of eventsOf(type)) {
          expect([...(frame.memberIds ?? [])].sort()).toEqual(
            [alice.memberId, bob.memberId].sort(),
          );
        }
      }
    });

    it('delivers DM events to the DM owner only', async () => {
      const dm = await dmOf(alice, alpha);
      realtime = [];
      await post(alice, dm, { markdown: 'secret' });
      for (const frame of realtime.filter((e) => e.event.type !== 'agents.changed')) {
        expect(frame.memberIds).toEqual([alice.memberId]);
      }
      expect(eventsOf('message.upserted')).toHaveLength(2);
    });
  });

  // ---------- compatibility with the legacy routes ----------
  describe('legacy chat routes', () => {
    it('keeps a root message id working as a chat id', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'Plan', threadTitle: 'Plan' });
      expect(await call<Chat>('get', `/chats/${root.id}`, bob)).toEqual({
        id: root.id,
        kind: 'thread',
        title: 'Plan',
        subtitle: '# team',
        agentIds: [alpha.id, beta.id],
      });
      const sent = await call<Message>('post', `/chats/${root.id}/messages`, bob, {
        markdown: '@Alpha via the old route',
      });
      expect(sent).toMatchObject({ parentId: root.id, chatId: root.id, roomId: room.id });
      const list = await call<Message[]>('get', `/chats/${root.id}/messages`, bob);
      expect(list.map((m) => m.author.kind)).toEqual(['human', 'human', 'agent']);
      const sidebar = (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)!;
      expect(sidebar.threads).toEqual([
        expect.objectContaining({ id: root.id, name: 'Plan', unread: 2, connectionId: null }),
      ]);
      await call('post', `/chats/${root.id}/read`, alice);
      expect(
        (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)!.threads[0]
          .unread,
      ).toBe(0);
      // plain main-timeline messages are not sidebar threads
      await post(alice, room.id, { markdown: 'just chatting' });
      expect(
        (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)!.threads,
      ).toHaveLength(1);
    });

    it('wraps thread creation: POST /rooms/:id/threads posts a titled root', async () => {
      const room = await teamRoom();
      const root = await call<Message>('post', `/rooms/${room.id}/threads`, bob, {
        name: ' Kickoff ',
        message: '@Beta start',
      });
      expect(root).toMatchObject({
        roomId: room.id,
        parentId: null,
        threadTitle: 'Kickoff',
        markdown: '@Beta start',
        thread: { title: 'Kickoff', replyCount: 1 },
      });
      const bare = await call<Message>('post', `/rooms/${room.id}/threads`, bob, { name: 'Bare' });
      expect(bare).toMatchObject({ markdown: 'Bare', threadTitle: 'Bare' });
    });
  });
  // ---------- phase C1 review fixes ----------
  describe('review fixes', () => {
    const rowOf = (id: string) => dataSource.getRepository(ChatMessage).findOneByOrFail({ id });
    const repliesOf = async (client: LoggedInClient, roomId: string, rootId: string) =>
      (await threadOf(client, roomId, rootId)).replies;

    it('does not wake an agent for an address like foo@Alpha.com', async () => {
      const room = await teamRoom();
      const mail = await post(alice, room.id, { markdown: 'write to foo@Alpha.com please' });
      expect(await assignments()).toHaveLength(0);
      expect(mail.skippedAgents).toBeUndefined();
      await post(alice, room.id, { markdown: 'write to foo and (@alpha) please' });
      expect(await assignments()).toHaveLength(1);
    });

    it('counts a reply once when the same message is deleted twice at the same time', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root' });
      const first = await post(bob, room.id, { markdown: 'one', parentId: root.id });
      await post(bob, room.id, { markdown: 'two', parentId: root.id });
      await Promise.all([
        raw('delete', `/rooms/${room.id}/messages/${first.id}`, bob),
        raw('delete', `/rooms/${room.id}/messages/${first.id}`, alice),
        raw('delete', `/rooms/${room.id}/messages/${first.id}`, bob),
      ]);
      expect((await rowOf(root.id)).replyCount).toBe(1);
      expect((await rowOf(first.id)).deletedAt).not.toBeNull();
    });

    describe('migrated placeholder roots', () => {
      it('are skipped by unread and previews, and sort before their first reply', async () => {
        const room = await teamRoom();
        const rootId = randomUUID();
        const seq = 900_000_000;
        const at = new Date(Date.now() - 60_000);
        const insert = (
          id: string,
          parent: string | null,
          kind: string,
          text: string,
          flag: boolean,
        ) =>
          dataSource.query(
            `INSERT INTO messages (id, workspace_id, room_id, parent_id, seq, author_kind, author_member_id,
                                   external_name, status, markdown, thread_title, created_at, system_root, reply_count)
             OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'complete', $9, $10, $11, $12, $13)`,
            [
              id,
              owner.workspaceId,
              room.id,
              parent,
              seq,
              kind,
              kind === 'human' ? bob.memberId : null,
              kind === 'external' ? 'System' : null,
              text,
              parent ? null : text,
              at,
              flag,
              parent ? 0 : 1,
            ],
          );
        await insert(rootId, null, 'external', 'Old thread', true);
        const replyId = randomUUID();
        await insert(replyId, rootId, 'human', 'bob replied', false);
        const sidebar = (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)!;
        expect(sidebar.threads).toEqual([
          expect.objectContaining({
            id: rootId,
            name: 'Old thread',
            unread: 1,
            preview: 'bob replied',
          }),
        ]);
        expect(
          (await call<Message[]>('get', `/chats/${rootId}/messages`, alice)).map((m) => m.id),
        ).toEqual([rootId, replyId]);
        // a thread of nothing but the placeholder is not unread, and previews as its name
        const lonely = randomUUID();
        await insert(lonely, null, 'external', 'Lonely', true);
        const again = (await call<Room[]>('get', '/rooms', alice)).find((r) => r.id === room.id)!;
        expect(again.threads.find((t) => t.id === lonely)).toMatchObject({
          unread: 0,
          preview: 'Lonely',
        });
      });

      it('are recognised by the backfill, and an empty one moves to its creation time', async () => {
        const room = await teamRoom();
        const first = await post(alice, room.id, { markdown: 'first' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const between = new Date();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const last = await post(alice, room.id, { markdown: 'last' });
        const rootId = randomUUID();
        // as the first migration left it: end of the room, not marked
        await dataSource.query(
          `INSERT INTO messages (id, workspace_id, room_id, author_kind, external_name, status, markdown, thread_title, created_at)
           VALUES ($1, $2, $3, 'external', 'System', 'complete', 'Empty one', 'Empty one', $4)`,
          [rootId, owner.workspaceId, room.id, between],
        );
        expect((await timeline(alice, room.id)).messages.map((m) => m.id)).toEqual([
          first.id,
          last.id,
          rootId,
        ]);
        for (const sql of SYSTEM_ROOT_BACKFILL) await dataSource.query(sql);
        expect((await rowOf(rootId)).systemRoot).toBe(true);
        expect((await rowOf(first.id)).systemRoot).toBe(false);
        expect((await timeline(alice, room.id)).messages.map((m) => m.id)).toEqual([
          first.id,
          rootId,
          last.id,
        ]);
      });
    });

    it("blanks a quote excerpt once the quoted reply's root is deleted", async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root' });
      const reply = await post(bob, room.id, { markdown: 'quoted words', parentId: root.id });
      const main = await post(alice, room.id, { markdown: 'about that', quoteMessageId: reply.id });
      expect((await timeline(alice, room.id)).messages[1].quote?.excerpt).toBe('quoted words');
      await call('delete', `/rooms/${room.id}/messages/${root.id}`, alice);
      const after = (await timeline(alice, room.id)).messages.find((m) => m.id === main.id)!;
      expect(after.quote).toMatchObject({ id: reply.id, excerpt: '' });
    });

    describe('wake rules', () => {
      it('continues a thread without a mention when exactly one agent answered in it', async () => {
        const room = await teamRoom();
        const trigger = await post(alice, room.id, { markdown: '@Alpha hello' });
        expect(await assignments()).toHaveLength(1);
        const follow = await post(bob, room.id, {
          markdown: 'and one more thing',
          parentId: trigger.id,
        });
        expect(follow.skippedAgents).toBeUndefined();
        expect(await assignments()).toHaveLength(2);
        const replies = await repliesOf(alice, room.id, trigger.id);
        expect(replies.map((m) => m.author)).toEqual([
          { kind: 'agent', id: alpha.id },
          { kind: 'human', id: bob.memberId },
          { kind: 'agent', id: alpha.id },
        ]);
        // an explicit mention of another agent decides alone; a second voice ends the implicit wake
        await post(bob, room.id, { markdown: '@Beta your take?', parentId: trigger.id });
        expect(await assignments()).toHaveLength(3);
        await post(bob, room.id, { markdown: 'thanks both', parentId: trigger.id });
        expect(await assignments()).toHaveLength(3);
        // the main timeline never continues by itself
        await post(bob, room.id, { markdown: 'plain chat' });
        expect(await assignments()).toHaveLength(3);
      });

      it('does not continue when the agent left the room or its computer is offline', async () => {
        const room = await teamRoom();
        const trigger = await post(alice, room.id, { markdown: '@Alpha hello' });
        await dataSource.query(`UPDATE computers SET status = 'offline' WHERE id = $1`, [
          computerId,
        ]);
        await post(bob, room.id, { markdown: 'still there?', parentId: trigger.id });
        expect(await assignments()).toHaveLength(1);
        await dataSource.query(`UPDATE computers SET status = 'online' WHERE id = $1`, [
          computerId,
        ]);
        await call('delete', `/rooms/${room.id}/members/agent/${alpha.id}`, alice);
        await post(bob, room.id, { markdown: 'and now?', parentId: trigger.id });
        expect(await assignments()).toHaveLength(1);
      });

      it('lists mentioned agents that were not woken in the send response', async () => {
        const gamma = await createAgent(dataSource, owner.workspaceId, computerId, {
          name: 'Gamma',
        });
        const delta = await createAgent(dataSource, owner.workspaceId, computerId, {
          name: 'Delta',
        });
        const off = await createComputer(dataSource, owner.workspaceId, {
          name: 'asleep',
          status: 'offline',
        });
        const sleeper = await createAgent(dataSource, owner.workspaceId, off.id, {
          name: 'Sleeper',
        });
        const stranger = await createAgent(dataSource, owner.workspaceId, computerId, {
          name: 'Stranger',
        });
        const room = await teamRoom('crowd', [alpha.id, beta.id, gamma.id, delta.id, sleeper.id]);
        const sent = await post(alice, room.id, {
          markdown: '@Sleeper @Stranger @Alpha @Beta @Gamma @Delta',
        });
        expect(sent.skippedAgents).toEqual([
          { agentId: sleeper.id, name: 'Sleeper', reason: 'offline' },
          { agentId: stranger.id, name: 'Stranger', reason: 'not_in_room' },
          { agentId: delta.id, name: 'Delta', reason: 'limit' },
        ]);
        expect((await repliesOf(alice, room.id, sent.id)).map((m) => m.author)).toEqual([
          { kind: 'agent', id: alpha.id },
          { kind: 'agent', id: beta.id },
          { kind: 'agent', id: gamma.id },
        ]);
        // events and later reads never carry it
        const stored = (await timeline(alice, room.id)).messages[0];
        expect(stored.skippedAgents).toBeUndefined();
        for (const e of eventsOf('message.upserted')) {
          expect((e.event as { message: Message }).message.skippedAgents).toBeUndefined();
        }
      });
    });

    it('gives a thread started by a channel mention the room context before it', async () => {
      const room = await teamRoom();
      await post(alice, room.id, { markdown: 'context one' });
      const gone = await post(alice, room.id, { markdown: 'secret deleted' });
      await call('delete', `/rooms/${room.id}/messages/${gone.id}`, alice);
      await post(bob, room.id, { markdown: 'context two' });
      const trigger = await post(alice, room.id, { markdown: '@Alpha what do you think?' });
      const [reply] = await repliesOf(alice, room.id, trigger.id);
      const briefs = app.get(AssignmentBriefService);
      const build = async (messageId: string) => {
        const assignment = await assignmentOf(messageId);
        const agent = await dataSource
          .getRepository(Agent)
          .findOneByOrFail({ id: assignment.agentId });
        return (await briefs.build(assignment, agent, null))!;
      };
      const brief = await build(reply.id);
      expect(brief.context).toContain('Earlier in the room (oldest first):');
      expect(brief.context.indexOf('context one')).toBeGreaterThan(-1);
      expect(brief.context.indexOf('context one')).toBeLessThan(
        brief.context.indexOf('context two'),
      );
      expect(brief.context).not.toContain('secret deleted');
      expect(brief.context).not.toContain('- **Extra member**: @Alpha');
      // the session key is still the thread root
      expect(await app.get(ChatService).chatIdOfReply((await assignmentOf(reply.id)).id)).toBe(
        trigger.id,
      );
      // a follow-up in the thread (a different ask) is not a new thread: no room context
      await post(bob, room.id, { markdown: 'follow up', parentId: trigger.id });
      const second = (await repliesOf(alice, room.id, trigger.id)).filter(
        (m) => m.author.kind === 'agent',
      )[1];
      expect((await build(second.id)).context).not.toContain('Earlier in the room (');
      // a DM has no such context either
      const dm = await dmOf(alice, alpha);
      await post(alice, dm, { markdown: 'dm one' });
      const dmReply = (await timeline(alice, dm)).messages.find((m) => m.author.kind === 'agent')!;
      expect((await build(dmReply.id)).context).not.toContain('Earlier in the room (');
    });

    it('answers 404 when editing or deleting a reply under a deleted root', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root' });
      const reply = await post(bob, room.id, { markdown: 'mine', parentId: root.id });
      await call('delete', `/rooms/${room.id}/messages/${root.id}`, alice);
      await fail('patch', `/rooms/${room.id}/messages/${reply.id}`, bob, 404, { markdown: 'edit' });
      await fail('delete', `/rooms/${room.id}/messages/${reply.id}`, bob, 404);
      await fail('delete', `/rooms/${room.id}/messages/${reply.id}`, alice, 404);
      // the root itself stays idempotent
      expect(
        (await call<Message>('delete', `/rooms/${room.id}/messages/${root.id}`, alice)).deleted,
      ).toBe(true);
      expect((await rowOf(reply.id)).deletedAt).toBeNull();
    });

    it('lets the member who asked delete the agent reply, nobody else', async () => {
      const carol = await addMemberWithRole(dataSource, owner, 'member');
      const room = await createRoom(alice, {
        name: 'asks',
        memberIds: [bob.memberId, carol.memberId],
        agentIds: [alpha.id],
      });
      const trigger = await post(bob, room.id, { markdown: '@Alpha do it' });
      const [reply] = await repliesOf(alice, room.id, trigger.id);
      await fail('delete', `/rooms/${room.id}/messages/${reply.id}`, carol, 403);
      const gone = await call<Message>('delete', `/rooms/${room.id}/messages/${reply.id}`, bob);
      expect(gone).toMatchObject({ id: reply.id, deleted: true });
      expect((await assignmentOf(reply.id)).status).toBe('cancelled');
      // still not a license to delete other people's messages
      const carols = await post(carol, room.id, { markdown: 'carol', parentId: trigger.id });
      await fail('delete', `/rooms/${room.id}/messages/${carols.id}`, bob, 403);
    });

    it('does not read @mentions from the fallback thread name', async () => {
      const room = await teamRoom();
      const named = await call<Message>('post', `/rooms/${room.id}/threads`, bob, {
        name: '@Alpha',
      });
      expect(named).toMatchObject({ markdown: '@Alpha', threadTitle: '@Alpha' });
      expect(await assignments()).toHaveLength(0);
      const plain = await call<Message>('post', `/rooms/${room.id}/threads`, bob, {
        name: '@Beta',
        message: 'no mention here',
      });
      expect(plain.markdown).toBe('no mention here');
      expect(await assignments()).toHaveLength(0);
      await call<Message>('post', `/rooms/${room.id}/threads`, bob, {
        name: 'Ask',
        message: '@Beta go',
      });
      expect(await assignments()).toHaveLength(1);
    });

    it('writes nothing into a reply that was deleted while it streamed', async () => {
      const room = await teamRoom();
      const trigger = await post(alice, room.id, { markdown: '@Alpha work' });
      const [reply] = await repliesOf(alice, room.id, trigger.id);
      await call('delete', `/rooms/${room.id}/messages/${reply.id}`, alice);
      // the assignment ended (cancelled): the failure hook must not touch the placeholder
      const row = await rowOf(reply.id);
      expect(row).toMatchObject({ markdown: '', status: 'streaming' });
      expect(row.deletedAt).not.toBeNull();
    });

    it('answers 404 when the room is deleted while a message is being stored', async () => {
      const room = await teamRoom();
      const store = app.get(MessageStore);
      const auth = {
        memberId: bob.memberId,
        workspaceId: bob.workspaceId,
        role: 'member',
      } as AuthContext;
      const send = store.send.bind(store);
      // delete the room right after the access check, before the insert (the lost race)
      const original = (store as unknown as { resolveRoom: MessageStore['resolveRoom'] })
        .resolveRoom;
      let armed = true;
      (store as unknown as { resolveRoom: MessageStore['resolveRoom'] }).resolveRoom = async (
        ...args
      ) => {
        const scope = await original.apply(store, args);
        if (armed) {
          armed = false;
          await dataSource.query(`DELETE FROM rooms WHERE id = $1`, [room.id]);
        }
        return scope;
      };
      try {
        await expect(send(auth, room.id, { markdown: 'too late' })).rejects.toMatchObject({
          response: { message: 'chat.ROOM_NOT_FOUND' },
        });
      } finally {
        (store as unknown as { resolveRoom: MessageStore['resolveRoom'] }).resolveRoom = original;
      }
    });
  });
});

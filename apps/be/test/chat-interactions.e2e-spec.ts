// Must come first: the spec runs the in-process agent simulator (see simulator-env).
import './utils/simulator-env';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  ApiResponse,
  MentionFeedPage,
  Message,
  MuteState,
  PinItem,
  PresenceEntry,
  ReadState,
  Room,
  RoomTimelinePage,
  Thread,
  ThreadPage,
} from '@repo/shared';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { EventsService, REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import { ChatInteractionsFixes1792291400000 } from '../src/database/migrations/1792291400000-ChatInteractionsFixes';
import { ChatStreamService } from '../src/modules/daemon/chat-stream.service';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { Random, TaskTimers } from '../src/modules/tasks/task-timers';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  TestClock,
  truncateAll,
} from './utils';

/** Timers that only run when the test fires them, one at a time. */
class ManualTimers extends TaskTimers {
  pending: (() => void)[] = [];
  override later(_ms: number, fn: () => void): void {
    this.pending.push(fn);
  }
}

class FixedRandom extends Random {
  override next(): number {
    return 0.99;
  }
}

interface Claimed {
  id: string;
  attempt: number;
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
const NIL = '00000000-0000-0000-0000-000000000000';
const THUMB = '👍';
const HEART = '❤️';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Chat interactions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;
  let events: EventsService;
  let port: number;
  const clock = new TestClock();
  const timers = new ManualTimers();

  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let alice: LoggedInClient;
  let bob: LoggedInClient;
  let dana: LoggedInClient;
  let stranger: LoggedInClient;
  let daemonKey: { Authorization: string };
  let realAgent: Agent;
  let simAgent: Agent;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(TaskTimers)
        .useValue(timers)
        .overrideProvider(Random)
        .useValue(new FixedRandom()),
    ));
    await app.listen(0);
    port = ((app.getHttpServer() as unknown as http.Server).address() as AddressInfo).port;
    emitter = app.get(EventEmitter2);
    events = app.get(EventsService);
  });

  afterAll(async () => {
    await app.close();
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
  const named = async (client: LoggedInClient, name: string): Promise<LoggedInClient> => {
    await dataSource.query(`UPDATE members SET name = $2 WHERE id = $1`, [client.memberId, name]);
    return client;
  };
  const createRoom = (client: LoggedInClient, body: object) =>
    call<Room>('post', '/rooms', client, body);
  const post = (client: LoggedInClient, roomId: string, body: object) =>
    call<Message>('post', `/rooms/${roomId}/messages`, client, body);
  const timeline = (client: LoggedInClient, roomId: string) =>
    call<RoomTimelinePage>('get', `/rooms/${roomId}/messages`, client);
  const threadOf = (client: LoggedInClient, roomId: string, rootId: string) =>
    call<ThreadPage>('get', `/rooms/${roomId}/messages/${rootId}/thread`, client);
  const rooms = (client: LoggedInClient) => call<Room[]>('get', '/rooms', client);
  const roomOf = async (client: LoggedInClient, id: string) =>
    (await rooms(client)).find((room) => room.id === id)!;
  const threads = (client: LoggedInClient, roomId: string, query = '') =>
    call<Thread[]>('get', `/rooms/${roomId}/threads${query}`, client);
  const react = (client: LoggedInClient, roomId: string, mid: string, key: string) =>
    call<Message>(
      'put',
      `/rooms/${roomId}/messages/${mid}/reactions/${encodeURIComponent(key)}`,
      client,
    );
  const unreact = (client: LoggedInClient, roomId: string, mid: string, key: string) =>
    call<Message>(
      'delete',
      `/rooms/${roomId}/messages/${mid}/reactions/${encodeURIComponent(key)}`,
      client,
    );
  const eventsOf = (type: string) => realtime.filter((e) => e.event.type === type);

  /** Alice's public room: bob, dana, both agents belong to it. */
  const teamRoom = () =>
    createRoom(alice, {
      name: 'team',
      memberIds: [bob.memberId, dana.memberId],
      agentIds: [realAgent.id, simAgent.id],
    });
  /** Alice's private room: only bob and the real agent. */
  const secretRoom = () =>
    createRoom(alice, {
      name: 'secret',
      isPrivate: true,
      memberIds: [bob.memberId],
      agentIds: [realAgent.id],
    });

  // ---------- gateway over HTTP (a daemon) ----------
  const pair = async (): Promise<{ computerId: string; key: { Authorization: string } }> => {
    const code = (await call<{ code: string }>('post', '/computers/pairing-codes', owner)).code;
    const res = await request(app.getHttpServer())
      .post('/api/v1/gateway/pair')
      .send({ code, name: 'test-mac', os: 'macOS 26.1 · arm64', cliVersion: '0.1.0' })
      .expect(200);
    const data = (res.body as ApiResponse<{ computerId: string; apiKey: string }>).data;
    return { computerId: data.computerId, key: { Authorization: `Bearer ${data.apiKey}` } };
  };
  const gw = async <T>(path: string, body: object, status = 200): Promise<T> => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/gateway${path}`)
      .set(daemonKey)
      .send(body);
    expect(res.status).toBe(status);
    return (res.body as ApiResponse<T>).data;
  };
  /** The daemon claims the oldest offered reply and accepts it: a running run. */
  const claimAndAccept = async (): Promise<Claimed> => {
    const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
    await gw(`/assignments/${claimed.id}/accept`, { attempt: claimed.attempt });
    return claimed;
  };
  const replyIn = async (
    client: LoggedInClient,
    roomId: string,
    rootId: string,
  ): Promise<Message> => (await threadOf(client, roomId, rootId)).replies.at(-1)!;

  /** Fires the manual timers one by one until the condition holds. */
  const drainUntil = async (done: () => boolean | Promise<boolean>): Promise<void> => {
    const started = Date.now();
    while (!(await done())) {
      if (Date.now() - started > 20_000) throw new Error('timed out draining timers');
      if (timers.pending.length) timers.pending.shift()!();
      await sleep(3);
    }
  };

  beforeEach(async () => {
    await truncateAll(dataSource);
    timers.pending = [];
    owner = await registerAndLogin(app);
    await setPlan(dataSource, owner.workspaceId, 'team');
    admin = await named(await addMemberWithRole(dataSource, owner, 'admin'), 'Adam');
    alice = await named(await addMemberWithRole(dataSource, owner, 'member'), 'Alice');
    bob = await named(await addMemberWithRole(dataSource, owner, 'member'), 'Bob');
    dana = await named(await addMemberWithRole(dataSource, owner, 'member'), 'Dana');
    stranger = await registerAndLogin(app);
    const paired = await pair();
    daemonKey = paired.key;
    realAgent = await createAgent(dataSource, owner.workspaceId, paired.computerId, {
      name: 'Alpha',
    });
    const simulated = await createComputer(dataSource, owner.workspaceId, {
      name: 'sim-box',
      simulated: true,
    });
    simAgent = await createAgent(dataSource, owner.workspaceId, simulated.id, { name: 'Sim' });
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (event: RealtimeEnvelope) => realtime.push(event));
  });

  // ---------- reactions ----------
  describe('reactions', () => {
    it('adds and removes idempotently, with per-viewer mine and one event per change', async () => {
      const room = await teamRoom();
      const msg = await post(alice, room.id, { markdown: 'ship it' });
      expect(msg.reactions).toEqual([]);

      realtime = [];
      const first = await react(bob, room.id, msg.id, THUMB);
      expect(first.reactions).toEqual([
        { key: THUMB, count: 1, mine: true, memberIds: [bob.memberId] },
      ]);
      // the same PUT again changes nothing: no second event
      expect((await react(bob, room.id, msg.id, THUMB)).reactions![0].count).toBe(1);
      await react(dana, room.id, msg.id, THUMB);
      await react(dana, room.id, msg.id, HEART);

      expect(eventsOf('message.reactions_updated')).toHaveLength(3);
      const last = eventsOf('message.reactions_updated').at(-1)!;
      expect(last.memberIds).toEqual(expect.arrayContaining([alice.memberId, bob.memberId]));
      expect(last.event).toEqual({
        type: 'message.reactions_updated',
        roomId: room.id,
        messageId: msg.id,
        parentId: null,
        reactions: [
          { key: THUMB, count: 2, memberIds: [bob.memberId, dana.memberId] },
          { key: HEART, count: 1, memberIds: [dana.memberId] },
        ],
      });

      // timelines carry mine for the viewer; message.upserted events never do
      const bobView = (await timeline(bob, room.id)).messages[0].reactions!;
      const aliceView = (await timeline(alice, room.id)).messages[0].reactions!;
      expect(bobView.map((r) => [r.key, r.mine])).toEqual([
        [THUMB, true],
        [HEART, false],
      ]);
      expect(aliceView.map((r) => r.mine)).toEqual([false, false]);

      realtime = [];
      const removed = await unreact(bob, room.id, msg.id, THUMB);
      expect(removed.reactions).toEqual([
        { key: THUMB, count: 1, mine: false, memberIds: [dana.memberId] },
        { key: HEART, count: 1, mine: false, memberIds: [dana.memberId] },
      ]);
      await unreact(bob, room.id, msg.id, THUMB); // idempotent
      expect(eventsOf('message.reactions_updated')).toHaveLength(1);
      await post(alice, room.id, { markdown: 'edited?' });
      for (const envelope of eventsOf('message.upserted')) {
        const message = (envelope.event as { message: Message }).message;
        for (const reaction of message.reactions ?? []) expect(reaction).not.toHaveProperty('mine');
      }
    });

    it('keeps the reactions of a thread reply on the reply, with the root as parentId', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'Plan' });
      const reply = await post(bob, room.id, { markdown: 'reply', parentId: root.id });
      realtime = [];
      await react(alice, room.id, reply.id, THUMB);
      expect(eventsOf('message.reactions_updated')[0].event).toMatchObject({
        messageId: reply.id,
        parentId: root.id,
      });
      expect((await threadOf(bob, room.id, root.id)).replies[0].reactions![0]).toMatchObject({
        key: THUMB,
        count: 1,
        mine: false,
      });
    });

    it('accepts one unicode emoji only (1..32 characters, no whitespace)', async () => {
      const room = await teamRoom();
      const msg = await post(alice, room.id, { markdown: 'x' });
      await react(alice, room.id, msg.id, '👍🏽');
      await react(alice, room.id, msg.id, '👨‍👩‍👧');
      await react(alice, room.id, msg.id, '🇻🇳');
      for (const key of ['a', 'abc', '👍 ', '👍👍', '<b>']) {
        expect(
          await fail(
            'put',
            `/rooms/${room.id}/messages/${msg.id}/reactions/${encodeURIComponent(key)}`,
            alice,
            400,
          ),
        ).toBe('A reaction must be a single emoji');
      }
    });

    it('is not available on deleted messages and caps the distinct emoji', async () => {
      const room = await teamRoom();
      const msg = await post(alice, room.id, { markdown: 'x' });
      const gone = await post(alice, room.id, { markdown: 'bye' });
      await call('delete', `/rooms/${room.id}/messages/${gone.id}`, alice);
      await fail(
        'put',
        `/rooms/${room.id}/messages/${gone.id}/reactions/${encodeURIComponent(THUMB)}`,
        bob,
        404,
      );
      const emoji = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '🙃', '😉', '😊', '😇'];
      const more = ['🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲'];
      for (const key of [...emoji, ...more].slice(0, 20)) await react(alice, room.id, msg.id, key);
      expect(
        await fail(
          'put',
          `/rooms/${room.id}/messages/${msg.id}/reactions/${encodeURIComponent('🥹')}`,
          alice,
          409,
        ),
      ).toMatch(/maximum number/);
      // joining an existing emoji is still fine at the cap
      expect((await react(bob, room.id, msg.id, '😀')).reactions![0].count).toBe(2);
    });

    it('never leaks from a private room: 404 for outsiders, events only to its members', async () => {
      const room = await secretRoom();
      const msg = await post(alice, room.id, { markdown: 'secret plans' });
      for (const client of [dana, admin, stranger]) {
        await fail(
          'put',
          `/rooms/${room.id}/messages/${msg.id}/reactions/${encodeURIComponent(THUMB)}`,
          client,
          404,
        );
        await fail(
          'delete',
          `/rooms/${room.id}/messages/${msg.id}/reactions/${encodeURIComponent(THUMB)}`,
          client,
          404,
        );
      }
      realtime = [];
      await react(bob, room.id, msg.id, THUMB);
      const [event] = eventsOf('message.reactions_updated');
      expect([...event.memberIds!].sort()).toEqual([alice.memberId, bob.memberId].sort());
    });
  });

  // ---------- read state ----------
  describe('read state', () => {
    it('counts the unread messages of others and the mentions per room', async () => {
      const room = await teamRoom();
      await post(alice, room.id, { markdown: 'one' });
      await post(alice, room.id, { markdown: 'hey @bob' });
      await post(bob, room.id, { markdown: 'mine' });
      await post(alice, room.id, { markdown: '@here standup' });

      expect(await roomOf(bob, room.id)).toMatchObject({
        unread: 3,
        mentions: 2,
        muted: false,
        lastReadSeq: 0,
      });
      expect(await roomOf(alice, room.id)).toMatchObject({ unread: 1, mentions: 0 });
      expect(await roomOf(dana, room.id)).toMatchObject({ unread: 4, mentions: 1 });
    });

    it('reads by seq: monotonic, capped, never backwards except through unread', async () => {
      const room = await teamRoom();
      const a = await post(alice, room.id, { markdown: 'a' });
      const b = await post(alice, room.id, { markdown: 'b' });
      const c = await post(alice, room.id, { markdown: 'c' });

      realtime = [];
      const state = await call<ReadState>('post', `/rooms/${room.id}/read`, bob, { seq: b.seq });
      expect(state).toEqual({
        roomId: room.id,
        rootId: null,
        lastReadSeq: b.seq,
        unread: 1,
        mentions: 0,
      });
      // only the member themself hears about it
      expect(eventsOf('read.updated')).toEqual([
        {
          workspaceId: owner.workspaceId,
          event: { type: 'read.updated', ...state },
          memberIds: [bob.memberId],
        },
      ]);
      // an older seq does not move the cursor back
      expect(
        (await call<ReadState>('post', `/rooms/${room.id}/read`, bob, { seq: a.seq! })).lastReadSeq,
      ).toBe(b.seq);
      // a seq beyond the room is capped at its last message
      expect(
        (await call<ReadState>('post', `/rooms/${room.id}/read`, bob, { seq: 10 ** 12 }))
          .lastReadSeq,
      ).toBe(c.seq);
      expect((await roomOf(bob, room.id)).unread).toBe(0);

      // mark unread from b: cursor = b.seq - 1, so b and c are unread again
      const back = await call<ReadState>('post', `/rooms/${room.id}/unread`, bob, {
        throughSeq: b.seq,
      });
      expect(back).toMatchObject({ lastReadSeq: b.seq! - 1, unread: 2 });
      await fail('post', `/rooms/${room.id}/unread`, bob, 400, { throughSeq: 0 });
      await fail('post', `/rooms/${room.id}/read`, bob, 400, { seq: -1 });
      await fail('post', `/rooms/${room.id}/read`, bob, 400, { seq: 'x' });
    });

    it('tracks threads: unread, mentions, cursor, the list and its filters', async () => {
      const room = await teamRoom();
      const t1 = await post(alice, room.id, { markdown: 'first root', threadTitle: 'One' });
      const r1 = await post(alice, room.id, { markdown: 'reply a', parentId: t1.id });
      const r2 = await post(alice, room.id, { markdown: 'psst @Bob', parentId: t1.id });
      const t2 = await post(dana, room.id, { markdown: 'second root', threadTitle: 'Two' });
      await post(dana, room.id, { markdown: 'reply', parentId: t2.id });

      const list = await threads(bob, room.id);
      expect(list.map((t) => [t.name, t.unread, t.mentions])).toEqual([
        ['Two', 2, 0],
        ['One', 3, 1],
      ]);
      expect(list[1]).toMatchObject({
        id: t1.id,
        lastReadSeq: 0,
        lastSeq: r2.seq,
        replyCount: 2,
        muted: false,
      });
      expect((await threads(bob, room.id, '?filter=unread')).map((t) => t.name)).toEqual([
        'Two',
        'One',
      ]);
      expect((await threads(bob, room.id, '?filter=mentioned')).map((t) => t.name)).toEqual([
        'One',
      ]);
      // threads bob took part in (wrote, or was mentioned in)
      expect((await threads(bob, room.id, '?filter=mine')).map((t) => t.name)).toEqual(['One']);
      expect((await threads(dana, room.id, '?filter=mine')).map((t) => t.name)).toEqual(['Two']);
      await fail('get', `/rooms/${room.id}/threads?filter=nope`, bob, 400);
      expect((await threads(bob, room.id, '?limit=1')).map((t) => t.name)).toEqual(['Two']);

      // the sidebar carries the same fields
      const sidebar = (await roomOf(bob, room.id)).threads.find((t) => t.id === t1.id)!;
      expect(sidebar).toMatchObject({ unread: 3, mentions: 1, lastReadSeq: 0, lastSeq: r2.seq });

      realtime = [];
      const read = await call<ReadState>('post', `/rooms/${room.id}/threads/${t1.id}/read`, bob, {
        seq: r1.seq,
      });
      expect(read).toEqual({
        roomId: room.id,
        rootId: t1.id,
        lastReadSeq: r1.seq,
        unread: 1,
        mentions: 1,
      });
      expect(eventsOf('read.updated')[0]).toMatchObject({ memberIds: [bob.memberId] });
      // monotonic
      expect(
        (
          await call<ReadState>('post', `/rooms/${room.id}/threads/${t1.id}/read`, bob, {
            seq: t1.seq!,
          })
        ).lastReadSeq,
      ).toBe(r1.seq);
      const all = await call<ReadState>('post', `/rooms/${room.id}/threads/${t1.id}/read`, bob, {
        seq: 10 ** 12,
      });
      expect(all).toMatchObject({ lastReadSeq: r2.seq, unread: 0, mentions: 0 });
      const unread = await call<ReadState>(
        'post',
        `/rooms/${room.id}/threads/${t1.id}/unread`,
        bob,
        {
          throughSeq: r2.seq,
        },
      );
      expect(unread).toMatchObject({ lastReadSeq: r2.seq! - 1, unread: 1, mentions: 1 });
      // a reply id resolves to its root
      expect(
        (await call<ReadState>('post', `/rooms/${room.id}/threads/${r1.id}/read`, bob, { seq: 0 }))
          .rootId,
      ).toBe(t1.id);
      await fail('post', `/rooms/${room.id}/threads/${NIL}/read`, bob, 404, { seq: 1 });
    });

    it('reads everything with read-all and keeps the legacy chat read working', async () => {
      const room = await teamRoom();
      const secret = await secretRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'T' });
      await post(alice, room.id, { markdown: 'reply', parentId: root.id });
      await post(alice, secret.id, { markdown: 'psst' });
      expect((await roomOf(bob, room.id)).unread).toBe(1);

      realtime = [];
      await call('post', '/rooms/read-all', bob);
      expect(eventsOf('rooms.changed')).toEqual([
        {
          workspaceId: owner.workspaceId,
          event: { type: 'rooms.changed' },
          memberIds: [bob.memberId],
        },
      ]);
      const after = await rooms(bob);
      expect(after.map((r) => r.unread ?? 0)).toEqual(after.map(() => 0));
      expect(after.find((r) => r.id === room.id)!.threads[0].unread).toBe(0);
      // alice's own state is untouched by bob's read-all
      await post(bob, room.id, { markdown: 'later' });
      expect((await roomOf(alice, room.id)).unread).toBe(1);

      // legacy: reading a thread through /chats moves the same cursor
      await post(alice, room.id, { markdown: 'again', parentId: root.id });
      expect((await roomOf(bob, room.id)).threads[0].unread).toBe(1);
      await call('post', `/chats/${root.id}/read`, bob);
      expect((await roomOf(bob, room.id)).threads[0]).toMatchObject({ unread: 0 });
    });

    it('starts a new member at the end of the room: nothing old is unread', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'old root', threadTitle: 'Old' });
      await post(alice, room.id, { markdown: 'old reply', parentId: root.id });
      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [admin.memberId] });
      const joined = await roomOf(admin, room.id);
      expect(joined).toMatchObject({ unread: 0, mentions: 0 });
      expect(joined.threads[0].unread).toBe(0);
      await post(alice, room.id, { markdown: 'new reply', parentId: root.id });
      expect((await roomOf(admin, room.id)).threads[0].unread).toBe(1);
    });

    it('answers 404 for rooms and threads the caller cannot open', async () => {
      const secret = await secretRoom();
      const msg = await post(alice, secret.id, { markdown: 'psst', threadTitle: 'S' });
      for (const client of [dana, admin, stranger]) {
        await fail('post', `/rooms/${secret.id}/read`, client, 404, { seq: 1 });
        await fail('post', `/rooms/${secret.id}/unread`, client, 404, { throughSeq: 1 });
        await fail('post', `/rooms/${secret.id}/threads/${msg.id}/read`, client, 404, { seq: 1 });
        await fail('get', `/rooms/${secret.id}/threads`, client, 404);
        await fail('post', `/rooms/${secret.id}/mute`, client, 404);
      }
    });
  });

  // ---------- mentions ----------
  describe('mentions', () => {
    it('resolves members case-insensitively, @here and @room; edits rewrite them', async () => {
      const room = await teamRoom();
      const msg = await post(alice, room.id, { markdown: 'hello @BOB and @dana' });
      expect(await roomOf(bob, room.id)).toMatchObject({ unread: 1, mentions: 1 });
      expect(await roomOf(dana, room.id)).toMatchObject({ mentions: 1 });

      await call('patch', `/rooms/${room.id}/messages/${msg.id}`, alice, {
        markdown: 'only @Dana',
      });
      expect((await roomOf(bob, room.id)).mentions).toBe(0);
      expect((await roomOf(dana, room.id)).mentions).toBe(1);

      await post(alice, room.id, { markdown: '@room everyone' });
      expect((await roomOf(bob, room.id)).mentions).toBe(1);
      expect((await roomOf(dana, room.id)).mentions).toBe(2);
      // an address is no mention, and neither is a longer word
      await post(alice, room.id, { markdown: 'mail me@here.com or @hereby @bobby' });
      expect((await roomOf(bob, room.id)).mentions).toBe(1);
      // the author never has mentions of their own messages
      await post(bob, room.id, { markdown: '@Bob @here' });
      expect((await roomOf(bob, room.id)).mentions).toBe(1);
      expect((await roomOf(alice, room.id)).mentions).toBe(1);
    });

    it('lists the @me feed newest first with room and thread info, paged and private-safe', async () => {
      const room = await teamRoom();
      const secret = await secretRoom();
      const m1 = await post(alice, room.id, { markdown: 'first @Bob' });
      const root = await post(dana, room.id, { markdown: 'root', threadTitle: 'Plan' });
      const m2 = await post(dana, room.id, { markdown: 'in thread @bob', parentId: root.id });
      const m3 = await post(alice, secret.id, { markdown: 'secret @Bob' });
      // dana is not in the private room: her mention of her is never stored for others to see
      await post(alice, secret.id, { markdown: 'hello @Dana' });
      await post(bob, room.id, { markdown: '@Bob myself' });

      const feed = await call<MentionFeedPage>('get', '/mentions', bob);
      expect(feed.hasMore).toBe(false);
      expect(feed.items.map((i) => i.message.id)).toEqual([m3.id, m2.id, m1.id]);
      expect(feed.items[0]).toMatchObject({
        roomId: secret.id,
        roomName: 'secret',
        threadRootId: null,
      });
      expect(feed.items[1]).toMatchObject({
        roomId: room.id,
        roomName: 'team',
        threadRootId: root.id,
        threadTitle: 'Plan',
      });

      const page1 = await call<MentionFeedPage>('get', '/mentions?limit=2', bob);
      expect(page1.items.map((i) => i.message.id)).toEqual([m3.id, m2.id]);
      expect(page1.hasMore).toBe(true);
      const page2 = await call<MentionFeedPage>(
        'get',
        `/mentions?limit=2&before=${page1.items[1].message.seq}`,
        bob,
      );
      expect(page2.items.map((i) => i.message.id)).toEqual([m1.id]);
      expect(page2.hasMore).toBe(false);

      // dana sees only what she may open
      expect((await call<MentionFeedPage>('get', '/mentions', dana)).items).toEqual([]);
      expect((await call<MentionFeedPage>('get', '/mentions', stranger)).items).toEqual([]);

      // deleted messages and messages of a deleted thread root disappear
      await call('delete', `/rooms/${room.id}/messages/${m1.id}`, alice);
      await call('delete', `/rooms/${room.id}/messages/${root.id}`, dana);
      expect(
        (await call<MentionFeedPage>('get', '/mentions', bob)).items.map((i) => i.message.id),
      ).toEqual([m3.id]);
    });

    it('stores the mention of a member an agent addresses in its reply', async () => {
      const room = await teamRoom();
      const msg = await post(bob, room.id, { markdown: '@Alpha say hi to Dana' });
      const reply = await replyIn(bob, room.id, msg.id);
      const claimed = await claimAndAccept();
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: claimed.attempt,
        status: 'completed',
        text: 'Hi @Dana! @here too',
      });
      expect(reply.author).toMatchObject({ kind: 'agent', id: realAgent.id });
      const feed = await call<MentionFeedPage>('get', '/mentions', dana);
      // @here of an agent never notifies the room
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].message.markdown).toBe('Hi @Dana! @here too');
      expect((await call<MentionFeedPage>('get', '/mentions', alice)).items).toEqual([]);
    });
  });

  // ---------- mutes ----------
  describe('mutes', () => {
    it('flags a muted room and thread without hiding their counts, idempotently', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'T' });
      await post(alice, room.id, { markdown: 'reply @Bob', parentId: root.id });

      realtime = [];
      expect(await call<MuteState>('post', `/rooms/${room.id}/mute`, bob)).toEqual({
        roomId: room.id,
        rootId: null,
        muted: true,
      });
      await call('post', `/rooms/${room.id}/mute`, bob);
      expect(eventsOf('rooms.changed').every((e) => e.memberIds!.join() === bob.memberId)).toBe(
        true,
      );
      let view = await roomOf(bob, room.id);
      expect(view).toMatchObject({ muted: true, unread: 1 });
      expect(view.threads[0]).toMatchObject({ muted: false, unread: 2, mentions: 1 });
      // other members are unaffected
      expect((await roomOf(dana, room.id)).muted).toBe(false);

      expect(
        await call<MuteState>('post', `/rooms/${room.id}/threads/${root.id}/mute`, bob),
      ).toEqual({ roomId: room.id, rootId: root.id, muted: true });
      view = await roomOf(bob, room.id);
      expect(view.threads[0]).toMatchObject({ muted: true, unread: 2, mentions: 1 });
      expect((await threads(bob, room.id))[0].muted).toBe(true);

      await call('delete', `/rooms/${room.id}/mute`, bob);
      await call('delete', `/rooms/${room.id}/mute`, bob);
      await call('delete', `/rooms/${room.id}/threads/${root.id}/mute`, bob);
      view = await roomOf(bob, room.id);
      expect(view.muted).toBe(false);
      expect(view.threads[0].muted).toBe(false);
      await fail('post', `/rooms/${room.id}/threads/${NIL}/mute`, bob, 404);
      await fail('post', `/rooms/${room.id}/mute`, stranger, 404);
    });
  });

  // ---------- pins ----------
  describe('pins', () => {
    it('pins rooms, threads and messages per member, resolved and ordered', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root text', threadTitle: 'Plan' });
      const reply = await post(bob, room.id, { markdown: '**bold** reply', parentId: root.id });
      const plain = await post(alice, room.id, { markdown: 'Plain message\nsecond line' });

      realtime = [];
      const pinRoom = await call<PinItem>('post', '/pins', bob, {
        targetType: 'room',
        targetId: room.id,
      });
      expect(pinRoom).toMatchObject({
        targetType: 'room',
        targetId: room.id,
        title: 'team',
        roomName: 'team',
        position: 0,
        messageId: null,
        threadRootId: null,
      });
      expect(eventsOf('pins.changed')).toEqual([
        {
          workspaceId: owner.workspaceId,
          event: { type: 'pins.changed' },
          memberIds: [bob.memberId],
        },
      ]);
      // idempotent: the same pin comes back
      expect(
        (await call<PinItem>('post', '/pins', bob, { targetType: 'room', targetId: room.id })).id,
      ).toBe(pinRoom.id);
      // a reply id pins its thread by the root id
      const pinThread = await call<PinItem>('post', '/pins', bob, {
        targetType: 'thread',
        targetId: reply.id,
      });
      expect(pinThread).toMatchObject({
        targetId: root.id,
        title: 'Plan',
        threadRootId: root.id,
        messageId: root.id,
      });
      const pinMsg = await call<PinItem>('post', '/pins', bob, {
        targetType: 'message',
        targetId: plain.id,
      });
      expect(pinMsg).toMatchObject({
        title: 'Plain message',
        threadRootId: null,
        messageId: plain.id,
      });
      const pinReply = await call<PinItem>('post', '/pins', bob, {
        targetType: 'message',
        targetId: reply.id,
      });
      expect(pinReply).toMatchObject({ title: 'bold reply', threadRootId: root.id });

      expect((await call<PinItem[]>('get', '/pins', bob)).map((p) => p.id)).toEqual([
        pinRoom.id,
        pinThread.id,
        pinMsg.id,
        pinReply.id,
      ]);
      // pins are personal
      expect(await call<PinItem[]>('get', '/pins', alice)).toEqual([]);

      const reordered = await call<PinItem[]>('put', '/pins/order', bob, {
        ids: [pinReply.id, pinRoom.id],
      });
      expect(reordered.map((p) => [p.id, p.position])).toEqual([
        [pinReply.id, 0],
        [pinRoom.id, 1],
        [pinThread.id, 2],
        [pinMsg.id, 3],
      ]);
      await fail('put', '/pins/order', bob, 400, { ids: [pinRoom.id, pinRoom.id] });
      await fail('put', '/pins/order', bob, 400, { ids: [NIL] });
      const foreign = await call<PinItem>('post', '/pins', alice, {
        targetType: 'room',
        targetId: room.id,
      });
      await fail('put', '/pins/order', bob, 400, { ids: [foreign.id] });

      // deleting somebody else's pin (or an unknown id) is a silent no-op
      await call('delete', `/pins/${foreign.id}`, bob);
      expect(await call<PinItem[]>('get', '/pins', alice)).toHaveLength(1);
      await call('delete', `/pins/${pinMsg.id}`, bob);
      await call('delete', `/pins/${pinMsg.id}`, bob);
      await call('delete', '/pins/not-a-uuid', bob);
      expect((await call<PinItem[]>('get', '/pins', bob)).map((p) => p.id)).toEqual([
        pinReply.id,
        pinRoom.id,
        pinThread.id,
      ]);
    });

    it('rejects targets the caller cannot open, and skips ones they lose', async () => {
      const room = await teamRoom();
      const secret = await secretRoom();
      const msg = await post(alice, secret.id, { markdown: 'psst', threadTitle: 'S' });
      const open = await post(alice, room.id, { markdown: 'open' });
      for (const [targetType, targetId] of [
        ['room', secret.id],
        ['thread', msg.id],
        ['message', msg.id],
        ['message', NIL],
      ] as const) {
        await fail('post', '/pins', dana, 404, { targetType, targetId });
      }
      await fail('post', '/pins', dana, 400, { targetType: 'nope', targetId: room.id });

      await call('post', '/pins', bob, { targetType: 'room', targetId: secret.id });
      await call('post', '/pins', bob, { targetType: 'thread', targetId: msg.id });
      await call('post', '/pins', bob, { targetType: 'message', targetId: open.id });
      expect(await call<PinItem[]>('get', '/pins', bob)).toHaveLength(3);
      // bob leaves the private room: its pins are skipped
      await call('delete', `/rooms/${secret.id}/members/member/${bob.memberId}`, bob);
      expect((await call<PinItem[]>('get', '/pins', bob)).map((p) => p.targetId)).toEqual([
        open.id,
      ]);
      // a deleted message is skipped too
      await call('delete', `/rooms/${room.id}/messages/${open.id}`, alice);
      expect(await call<PinItem[]>('get', '/pins', bob)).toEqual([]);
    });

    it('allows at most 50 pins per member', async () => {
      const room = await teamRoom();
      const rows = Array.from({ length: 50 }, (_, i) => i);
      for (const i of rows) {
        const msg = await post(alice, room.id, { markdown: `m${i}` });
        await call('post', '/pins', bob, { targetType: 'message', targetId: msg.id });
      }
      const extra = await post(alice, room.id, { markdown: 'one too many' });
      expect(
        await fail('post', '/pins', bob, 409, { targetType: 'message', targetId: extra.id }),
      ).toBe('You can pin at most 50 items');
      expect(await call<PinItem[]>('get', '/pins', bob)).toHaveLength(50);
      // pinning something already pinned still answers
      const first = (await call<PinItem[]>('get', '/pins', bob))[0];
      await call('post', '/pins', bob, { targetType: 'message', targetId: first.targetId });
    }, 90_000);
  });

  // ---------- typing and presence ----------
  describe('typing and presence', () => {
    it('sends an ephemeral typing event to the room audience except the sender, throttled', async () => {
      const room = await secretRoom();
      realtime = [];
      await call('post', `/rooms/${room.id}/typing`, alice, {});
      await call('post', `/rooms/${room.id}/typing`, alice, {});
      const typing = eventsOf('presence.typing');
      expect(typing).toHaveLength(1);
      expect(typing[0].memberIds).toEqual([bob.memberId]);
      expect(typing[0].event).toEqual({
        type: 'presence.typing',
        roomId: room.id,
        parentId: null,
        memberId: alice.memberId,
        name: 'Alice',
      });
      // nothing is stored
      expect(
        (await dataSource.query(`SELECT count(*)::int AS n FROM messages`)) as { n: number }[],
      ).toEqual([{ n: 0 }]);

      clock.advance(2100);
      await call('post', `/rooms/${room.id}/typing`, alice, {});
      expect(eventsOf('presence.typing')).toHaveLength(2);
      // the other member has their own throttle
      await call('post', `/rooms/${room.id}/typing`, bob, {});
      expect(eventsOf('presence.typing').at(-1)!.memberIds).toEqual([alice.memberId]);
    });

    it('types in a thread, and never to or from people outside a private room', async () => {
      const room = await secretRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'T' });
      realtime = [];
      await call('post', `/rooms/${room.id}/typing`, bob, { parentId: root.id });
      expect(eventsOf('presence.typing')[0].event).toMatchObject({ parentId: root.id });
      for (const client of [dana, admin, stranger]) {
        await fail('post', `/rooms/${room.id}/typing`, client, 404, {});
      }
      await fail('post', `/rooms/${room.id}/typing`, bob, 404, { parentId: NIL });
      expect(eventsOf('presence.typing')).toHaveLength(1);
    });

    it('derives presence from open streams, debounces offline and reports idle', async () => {
      events.presenceOfflineDelayMs = 40;
      const open = (client: LoggedInClient): Promise<{ close: () => void }> =>
        new Promise((resolve, reject) => {
          const req = http.get(
            {
              host: '127.0.0.1',
              port,
              path: '/api/v1/events',
              headers: { Authorization: client.bearer.Authorization },
            },
            (res) => {
              res.setEncoding('utf8');
              res.on('data', () => undefined);
              resolve({ close: () => req.destroy() });
            },
          );
          req.on('error', reject);
        });
      const waitFor = async (check: () => boolean, ms = 3000) => {
        const started = Date.now();
        while (!check()) {
          if (Date.now() - started > ms) throw new Error('timeout');
          await sleep(10);
        }
      };
      const updates = () =>
        eventsOf('presence.update').map((e) => e.event as { memberId: string; status: string });
      try {
        realtime = [];
        const a = await open(alice);
        await waitFor(() => updates().length === 1);
        expect(updates()[0]).toEqual({
          type: 'presence.update',
          memberId: alice.memberId,
          status: 'online',
        });
        // visible to the whole workspace (no member filter), but not to another workspace
        expect(eventsOf('presence.update')[0].memberIds).toBeUndefined();
        expect(eventsOf('presence.update')[0].workspaceId).toBe(owner.workspaceId);

        expect(await call<PresenceEntry[]>('get', '/presence', bob)).toEqual([
          { memberId: alice.memberId, status: 'online' },
        ]);
        expect(await call<PresenceEntry[]>('get', '/presence', stranger)).toEqual([]);

        // a second stream of the same member changes nothing
        const a2 = await open(alice);
        await sleep(50);
        expect(updates()).toHaveLength(1);
        a.close();
        await sleep(120);
        expect(updates()).toHaveLength(1); // still one stream open

        await call('put', '/presence', alice, { status: 'idle' });
        expect(await call<PresenceEntry[]>('get', '/presence', bob)).toEqual([
          { memberId: alice.memberId, status: 'idle' },
        ]);
        await call('put', '/presence', alice, { status: 'online' });
        await fail('put', '/presence', alice, 400, { status: 'asleep' });

        // a reconnect inside the debounce never flaps to offline
        a2.close();
        const again = await open(alice);
        await sleep(150);
        expect(updates().map((u) => u.status)).toEqual(['online', 'idle', 'online']);
        again.close();
        await waitFor(() => updates().at(-1)!.status === 'offline');
        expect(await call<PresenceEntry[]>('get', '/presence', bob)).toEqual([]);
      } finally {
        events.presenceOfflineDelayMs = 5000;
      }
    });
  });

  // ---------- agent turns: phase, working, stop ----------
  describe('agent turns', () => {
    it('walks a daemon reply through queued, thinking, tool, writing and done', async () => {
      const room = await teamRoom();
      const root = await post(bob, room.id, { markdown: '@Alpha look into it' });
      let reply = await replyIn(bob, room.id, root.id);
      expect(reply).toMatchObject({
        status: 'streaming',
        phase: 'queued',
        startedAt: null,
        workedMs: null,
      });
      expect((await roomOf(bob, room.id)).workingAgentIds).toEqual([]);

      realtime = [];
      const claimed = await claimAndAccept();
      reply = await replyIn(bob, room.id, root.id);
      expect(reply).toMatchObject({ phase: 'thinking', activeTool: null, workedMs: null });
      expect(reply.startedAt).toEqual(expect.any(String));
      expect((await roomOf(bob, room.id)).workingAgentIds).toEqual([realAgent.id]);
      expect((await roomOf(alice, room.id)).workingAgentIds).toEqual([realAgent.id]);
      // the event of the accept carries the phase too
      const lastUpsert = () =>
        (eventsOf('message.upserted').at(-1)!.event as { message: Message }).message;
      expect(lastUpsert()).toMatchObject({ id: reply.id, phase: 'thinking' });

      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: claimed.attempt,
        events: [
          {
            kind: 'tool',
            call: { id: 't1', name: 'list_tasks', input: '{}', output: null, status: 'running' },
          },
        ],
      });
      reply = await replyIn(bob, room.id, root.id);
      expect(reply).toMatchObject({ phase: 'tool', activeTool: 'list_tasks' });
      expect(lastUpsert()).toMatchObject({ phase: 'tool', activeTool: 'list_tasks' });

      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: claimed.attempt,
        events: [
          {
            kind: 'tool',
            call: { id: 't1', name: 'list_tasks', input: '{}', output: '[]', status: 'ok' },
          },
          { kind: 'text', delta: 'Found ' },
        ],
      });
      await sleep(250);
      expect(lastUpsert()).toMatchObject({
        phase: 'writing',
        activeTool: null,
        markdown: 'Found ',
      });

      await gw(`/assignments/${claimed.id}/result`, {
        attempt: claimed.attempt,
        status: 'completed',
        text: 'Found nothing.',
      });
      reply = await replyIn(bob, room.id, root.id);
      expect(reply).toMatchObject({ status: 'complete', phase: 'done', activeTool: null });
      expect(reply.workedMs).toEqual(expect.any(Number));
      expect(reply.workedMs).toBeGreaterThanOrEqual(0);
      expect((await roomOf(bob, room.id)).workingAgentIds).toEqual([]);
    });

    it('marks a failed run failed', async () => {
      const room = await teamRoom();
      const root = await post(bob, room.id, { markdown: '@Alpha go' });
      const claimed = await claimAndAccept();
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: claimed.attempt,
        status: 'failed',
        error: 'daemon stopped',
      });
      expect(await replyIn(bob, room.id, root.id)).toMatchObject({
        status: 'failed',
        phase: 'failed',
      });
    });

    it('stops a daemon reply: partial text kept, the daemon is told, its late result is refused', async () => {
      const room = await teamRoom();
      const root = await post(bob, room.id, { markdown: '@Alpha write a long essay' });
      const claimed = await claimAndAccept();
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: claimed.attempt,
        events: [{ kind: 'text', delta: 'Once upon' }],
      });
      const reply = await replyIn(bob, room.id, root.id);

      // dana is neither the requester nor the room owner nor an admin
      expect(await fail('post', `/rooms/${room.id}/messages/${reply.id}/stop`, dana, 403)).toBe(
        'You are not allowed to do this in this room',
      );
      await fail('post', `/rooms/${room.id}/messages/${reply.id}/stop`, stranger, 404);

      realtime = [];
      const stopped = await call<Message>(
        'post',
        `/rooms/${room.id}/messages/${reply.id}/stop`,
        bob,
      );
      expect(stopped).toMatchObject({
        status: 'stopped',
        phase: 'stopped',
        markdown: 'Once upon',
        assignment: { status: 'cancelled' },
      });
      const upsert = eventsOf('message.upserted').at(-1)!.event as { message: Message };
      expect(upsert.message).toMatchObject({
        id: reply.id,
        status: 'stopped',
        markdown: 'Once upon',
      });
      expect((await roomOf(bob, room.id)).workingAgentIds).toEqual([]);

      // the daemon learns about it on the heartbeats and its progress, and its result is refused
      expect(await gw('/heartbeat', { running: [claimed.id] })).toMatchObject({
        cancelled: [claimed.id],
      });
      expect(
        await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: claimed.attempt }),
      ).toEqual({ ok: true, cancelled: true });
      expect(
        await gw(`/assignments/${claimed.id}/progress`, {
          attempt: claimed.attempt,
          events: [{ kind: 'text', delta: ' a time' }],
        }),
      ).toEqual({ ok: true, cancelled: true });
      // acknowledged and dropped: nothing is written and the stream buffer is gone
      expect(
        await gw(`/assignments/${claimed.id}/result`, {
          attempt: claimed.attempt,
          status: 'completed',
          text: 'x',
        }),
      ).toEqual({ ok: true });
      expect(app.get(ChatStreamService).textOf(claimed.id)).toBe('');
      await sleep(150);
      expect(await replyIn(bob, room.id, root.id)).toMatchObject({
        status: 'stopped',
        markdown: 'Once upon',
      });
      // stopping again is a no-op that answers the message; a finished reply cannot be stopped
      expect(
        (await call<Message>('post', `/rooms/${room.id}/messages/${reply.id}/stop`, bob)).status,
      ).toBe('stopped');
      // the requester stopped it themself: not an admin action, no audit row
      expect(
        (await dataSource.query(
          `SELECT count(*)::int AS n FROM audit_events WHERE action = 'chat.agent_stopped'`,
        )) as {
          n: number;
        }[],
      ).toEqual([{ n: 0 }]);
    });

    it('lets the room owner stop somebody else’s reply (audited) and rejects non-agent or finished messages', async () => {
      const room = await teamRoom();
      const root = await post(bob, room.id, { markdown: '@Alpha first' });
      const claimed = await claimAndAccept();
      const reply = await replyIn(bob, room.id, root.id);
      const stopped = await call<Message>(
        'post',
        `/rooms/${room.id}/messages/${reply.id}/stop`,
        alice,
      );
      expect(stopped.status).toBe('stopped');
      const audit = (await dataSource.query(
        `SELECT actor_member_id, target_id, meta FROM audit_events WHERE action = 'chat.agent_stopped'`,
      )) as {
        actor_member_id: string;
        target_id: string;
        meta: { roomId: string; agentId: string };
      }[];
      expect(audit).toEqual([
        {
          actor_member_id: alice.memberId,
          target_id: reply.id,
          meta: expect.objectContaining({
            roomId: room.id,
            agentId: realAgent.id,
            requestedBy: bob.memberId,
          }),
        },
      ]);
      expect(claimed.id).toBeTruthy();

      // a human message cannot be stopped; a completed reply neither
      await fail('post', `/rooms/${room.id}/messages/${root.id}/stop`, alice, 409);
      const second = await post(bob, room.id, { markdown: '@Alpha second', parentId: root.id });
      const next = await claimAndAccept();
      await gw(`/assignments/${next.id}/result`, {
        attempt: next.attempt,
        status: 'completed',
        text: 'done',
      });
      const done = await replyIn(bob, room.id, root.id);
      expect(second.id).toBeTruthy();
      await fail('post', `/rooms/${room.id}/messages/${done.id}/stop`, bob, 409);
      await fail('post', `/rooms/${room.id}/messages/${NIL}/stop`, bob, 404);
      // an owner/admin of the workspace who is a room member may stop it as well
      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [admin.memberId] });
      const third = await post(bob, room.id, { markdown: '@Alpha third', parentId: root.id });
      await claimAndAccept();
      const running = await replyIn(bob, room.id, root.id);
      expect(third.id).not.toBe(running.id);
      expect(
        (await call<Message>('post', `/rooms/${room.id}/messages/${running.id}/stop`, admin))
          .status,
      ).toBe('stopped');
    });

    it('stops a simulated reply mid-stream and the simulator stops writing', async () => {
      const room = await teamRoom();
      const msg = await post(bob, room.id, { markdown: '@Sim hello there' });
      const reply = await replyIn(bob, room.id, msg.id);
      expect(reply).toMatchObject({ phase: 'queued' });
      // offer, claim and accept, then the first streamed chunks (published, not stored)
      realtime = [];
      const written = () =>
        eventsOf('message.upserted').some((e) => {
          const m = (e.event as { message: Message }).message;
          return m.id === reply.id && m.markdown.length > 0;
        });
      await drainUntil(written);
      // let one more chunk land so there is partial text
      for (let i = 0; i < 3 && timers.pending.length; i++) {
        timers.pending.shift()!();
        await sleep(10);
      }
      const stopped = await call<Message>(
        'post',
        `/rooms/${room.id}/messages/${reply.id}/stop`,
        bob,
      );
      expect(stopped).toMatchObject({
        status: 'stopped',
        phase: 'stopped',
        assignment: { status: 'cancelled' },
      });
      expect(stopped.markdown.length).toBeGreaterThan(0);
      const partial = stopped.markdown;

      // the remaining timers fire: nothing more is written, the message stays as it was stopped
      while (timers.pending.length) {
        timers.pending.shift()!();
        await sleep(3);
      }
      await sleep(50);
      const after = await replyIn(bob, room.id, msg.id);
      expect(after).toMatchObject({ status: 'stopped', markdown: partial, phase: 'stopped' });
      expect(
        (await dataSource.getRepository(Assignment).findOneByOrFail({ sourceId: reply.id })).status,
      ).toBe('cancelled');
    });

    it('shows the simulated reply phase going queued, thinking, writing, done', async () => {
      const room = await teamRoom();
      const msg = await post(bob, room.id, { markdown: '@Sim go' });
      const seen: string[] = [];
      realtime = [];
      await drainUntil(async () => {
        const current = await replyIn(bob, room.id, msg.id);
        if (seen.at(-1) !== current.phase) seen.push(current.phase!);
        return current.status === 'complete';
      });
      const phases = eventsOf('message.upserted')
        .map((e) => (e.event as { message: Message }).message)
        .filter((m) => m.author.kind === 'agent')
        .map((m) => m.phase);
      expect(phases).toEqual(expect.arrayContaining(['thinking', 'writing', 'done']));
      expect(seen[0]).toBe('queued');
      expect(seen.at(-1)).toBe('done');
      expect(await replyIn(bob, room.id, msg.id)).toMatchObject({ workedMs: expect.any(Number) });
    });

    it('keeps stopping private: 404 outside the room', async () => {
      const room = await secretRoom();
      const root = await post(bob, room.id, { markdown: '@Alpha secret' });
      await claimAndAccept();
      const reply = await replyIn(bob, room.id, root.id);
      for (const client of [dana, admin, stranger]) {
        await fail('post', `/rooms/${room.id}/messages/${reply.id}/stop`, client, 404);
      }
    });
  });

  // ---------- member removal ----------
  // ---------- fix round ----------
  describe('fix round', () => {
    const rowsOf = async (table: string, memberId: string): Promise<number> =>
      (
        (await dataSource.query(`SELECT count(*)::int AS n FROM ${table} WHERE member_id = $1`, [
          memberId,
        ])) as { n: number }[]
      )[0].n;

    it('forgets read cursors, mutes and pins when a member leaves or is removed from a room', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'root', threadTitle: 'T' });
      await post(alice, room.id, { markdown: 'reply', parentId: root.id });
      for (const client of [bob, dana]) {
        await call('post', `/rooms/${room.id}/mute`, client);
        await call('post', `/rooms/${room.id}/threads/${root.id}/mute`, client);
        await call('post', `/rooms/${room.id}/threads/${root.id}/read`, client, {
          seq: root.seq,
        });
        await call('post', '/pins', client, { targetType: 'room', targetId: room.id });
        await call('post', '/pins', client, { targetType: 'thread', targetId: root.id });
      }
      await call('post', `/rooms/${room.id}/leave`, bob);
      await call('delete', `/rooms/${room.id}/members/member/${dana.memberId}`, alice);
      for (const client of [bob, dana]) {
        for (const table of ['room_reads', 'room_mutes', 'thread_mutes', 'thread_reads', 'pins']) {
          expect(await rowsOf(table, client.memberId)).toBe(0);
        }
      }
      // rejoining starts clean: no backlog as unread, no stale mute
      for (let i = 0; i < 4; i++) await post(alice, room.id, { markdown: `later ${i}` });
      await call('post', `/rooms/${room.id}/join`, bob);
      await call('post', `/rooms/${room.id}/members`, alice, { memberIds: [dana.memberId] });
      for (const client of [bob, dana]) {
        expect(await roomOf(client, room.id)).toMatchObject({ unread: 0, muted: false });
        expect(await call<PinItem[]>('get', '/pins', client)).toEqual([]);
      }
    });

    it('resets the cursor in the join trigger when a stale cursor row exists', async () => {
      const room = await teamRoom();
      for (let i = 0; i < 3; i++) await post(alice, room.id, { markdown: `m${i}` });
      // delete + insert behind the service's back: the old room_reads row stays
      await dataSource.query(`DELETE FROM room_members WHERE room_id = $1 AND member_id = $2`, [
        room.id,
        bob.memberId,
      ]);
      await dataSource.query(
        `UPDATE room_reads SET last_read_seq = 0, joined_seq = 0 WHERE member_id = $1`,
        [bob.memberId],
      );
      await dataSource.query(
        `INSERT INTO room_members (workspace_id, room_id, member_id, role, created_at)
         VALUES ($1, $2, $3, 'member', now())`,
        [owner.workspaceId, room.id, bob.memberId],
      );
      const row = (await dataSource.query(
        `SELECT last_read_seq::int AS r, joined_seq::int AS j FROM room_reads
         WHERE member_id = $1 AND room_id = $2`,
        [bob.memberId, room.id],
      )) as { r: number; j: number }[];
      expect(row[0].r).toBeGreaterThan(0);
      expect(row[0].j).toBe(row[0].r);
      expect(await roomOf(bob, room.id)).toMatchObject({ unread: 0 });
    });

    it('prunes hidden pins before the cap check and on listing', async () => {
      const room = await teamRoom();
      const secret = await secretRoom();
      const seed = (roomId: string, n: number) =>
        dataSource.query(
          `INSERT INTO pins (member_id, workspace_id, target_type, target_id, room_id, position)
           SELECT $1, $2, 'message', gen_random_uuid(), $3, g FROM generate_series(1, $4::int) g`,
          [bob.memberId, owner.workspaceId, roomId, n],
        );
      await seed(secret.id, 50);
      // bob lost the private room behind the service's back: all 50 pins are invisible
      await dataSource.query(`DELETE FROM room_members WHERE room_id = $1 AND member_id = $2`, [
        secret.id,
        bob.memberId,
      ]);
      expect(await call<PinItem[]>('get', '/pins', bob)).toEqual([]);
      expect(await rowsOf('pins', bob.memberId)).toBe(0); // pruned lazily on GET

      await seed(secret.id, 50);
      const msg = await post(alice, room.id, { markdown: 'visible' });
      const pin = await call<PinItem>('post', '/pins', bob, {
        targetType: 'message',
        targetId: msg.id,
      });
      expect(pin.messageId).toBe(msg.id); // the cap did not count the hidden pins
      expect(await rowsOf('pins', bob.memberId)).toBe(1);
    });

    it('moves joined_seq of old backfilled rows to the room last seq (migration)', async () => {
      const room = await teamRoom();
      const root = await post(alice, room.id, { markdown: 'old root', threadTitle: 'Old' });
      await post(alice, room.id, { markdown: 'old reply', parentId: root.id });
      await dataSource.query(`UPDATE room_reads SET joined_seq = 0 WHERE member_id = $1`, [
        bob.memberId,
      ]);
      expect((await threads(bob, room.id)).find((t) => t.id === root.id)!.unread).toBe(2);
      const runner = dataSource.createQueryRunner();
      try {
        await new ChatInteractionsFixes1792291400000().up(runner);
      } finally {
        await runner.release();
      }
      expect((await threads(bob, room.id)).find((t) => t.id === root.id)!.unread).toBe(0);
      await post(alice, room.id, { markdown: 'new reply', parentId: root.id });
      expect((await threads(bob, room.id)).find((t) => t.id === root.id)!.unread).toBe(1);
    });

    it('tracks idle per stream: idle only when every stream is idle, reset on a new stream', async () => {
      events.presenceOfflineDelayMs = 60;
      try {
        const owner1 = { memberId: alice.memberId, workspaceId: owner.workspaceId };
        const statuses = () =>
          eventsOf('presence.update').map((e) => (e.event as { status: string }).status);
        realtime = [];
        const off1 = events.registerStream(() => undefined, { ...owner1, sessionId: 's1' });
        const off2 = events.registerStream(() => undefined, { ...owner1, sessionId: 's2' });
        events.setIdle(owner.workspaceId, alice.memberId, true, 's1');
        expect(statuses()).toEqual(['online']); // s2 is still active
        events.setIdle(owner.workspaceId, alice.memberId, true, 's2');
        expect(statuses()).toEqual(['online', 'idle']);
        // a new stream starts active
        const off3 = events.registerStream(() => undefined, { ...owner1, sessionId: 's3' });
        expect(statuses()).toEqual(['online', 'idle', 'online']);
        events.setIdle(owner.workspaceId, alice.memberId, true, 's3');
        expect(statuses().at(-1)).toBe('idle');
        // everything closes and the member reconnects inside the debounce: online, never idle
        off1();
        off2();
        off3();
        const before = statuses().length;
        const off4 = events.registerStream(() => undefined, { ...owner1, sessionId: 's4' });
        expect(statuses().slice(before)).toEqual(['online']);
        await sleep(120);
        expect(statuses().slice(before)).toEqual(['online']);
        expect(events.presenceSnapshot(owner.workspaceId)).toEqual([
          { memberId: alice.memberId, status: 'online' },
        ]);
        off4();
        await sleep(120);
        expect(statuses().at(-1)).toBe('offline');
      } finally {
        events.presenceOfflineDelayMs = 5000;
      }
    });

    it('caps unread and mention counts at 100', async () => {
      const room = await teamRoom();
      for (let i = 0; i < 105; i++) await post(alice, room.id, { markdown: `@Bob ping ${i}` });
      expect(await roomOf(bob, room.id)).toMatchObject({ unread: 100, mentions: 100 });
      expect(await roomOf(dana, room.id)).toMatchObject({ unread: 100, mentions: 0 });
      const read = await call<ReadState>('post', `/rooms/${room.id}/read`, bob, { seq: 0 });
      expect(read.unread).toBeLessThanOrEqual(105);
    });
  });

  describe('cleanup', () => {
    it('drops a removed member’s cursors, mutes and pins', async () => {
      const room = await teamRoom();
      await call('post', `/rooms/${room.id}/mute`, dana);
      await call('post', '/pins', dana, { targetType: 'room', targetId: room.id });
      await call('post', `/rooms/${room.id}/read`, dana, { seq: 0 });
      await call('delete', `/members/${dana.memberId}`, owner);
      for (const table of ['room_reads', 'room_mutes', 'pins']) {
        expect(
          (await dataSource.query(`SELECT count(*)::int AS n FROM ${table} WHERE member_id = $1`, [
            dana.memberId,
          ])) as { n: number }[],
        ).toEqual([{ n: 0 }]);
      }
    });
  });
});

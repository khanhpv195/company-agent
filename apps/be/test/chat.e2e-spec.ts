// Must come first: the spec runs the in-process agent simulator (see simulator-env).
import './utils/simulator-env';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, Chat, Message, Room, Task } from '@repo/shared';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { CHAT_RUN_ENDED_EVENT, type ChatRunEndedPayload } from '../src/modules/chat/chat.constants';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { ChatService } from '../src/modules/chat/chat.service';
import { ChatMessage } from '../src/modules/chat/entities/chat-message.entity';
import { Room as RoomRow } from '../src/modules/chat/entities/room.entity';
import { EventsService, REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { AgentActivity } from '../src/modules/agents/entities/agent-activity.entity';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { DEMO_REPLIES } from '../src/modules/simulator/chat-script';
import { Random, TaskTimers } from '../src/modules/tasks/task-timers';
import { Member } from '../src/modules/workspace/entities/member.entity';
import {
  createAgent,
  createComputer,
  joinAll,
  createTestApp,
  LoggedInClient,
  mintAccessToken,
  registerAndLogin,
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
  value = 0.99;
  override next(): number {
    return this.value;
  }
}

interface Stream {
  chunks: () => string;
  waitFor: (text: string, ms?: number) => Promise<void>;
  close: () => void;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Chat (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;
  let events: EventsService;
  let chat: ChatService;
  let port: number;
  const clock = new TestClock();
  const timers = new ManualTimers();
  const random = new FixedRandom();

  let me: LoggedInClient;
  let bob: LoggedInClient;
  let a1: Agent;
  let a2: Agent;
  let a3: Agent;
  let threadId: string;
  let channelId: string;
  let realtime: RealtimeEnvelope[];
  let ended: ChatRunEndedPayload[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(TaskTimers)
        .useValue(timers)
        .overrideProvider(Random)
        .useValue(random),
    ));
    await app.listen(0);
    port = ((app.getHttpServer() as unknown as http.Server).address() as AddressInfo).port;
    emitter = app.get(EventEmitter2);
    events = app.get(EventsService);
    chat = app.get(ChatService);
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = async (memberId: string, workspaceId: string): Promise<LoggedInClient> => {
    const accessToken = await mintAccessToken(dataSource, {
      memberId,
      workspaceId,
      role: 'member',
    });
    return {
      accessToken,
      workspaceId,
      memberId,
      bearer: { Authorization: `Bearer ${accessToken}` },
    };
  };

  beforeEach(async () => {
    await truncateAll(dataSource);
    timers.pending = [];
    random.value = 0.99;
    me = await registerAndLogin(app);
    const workspaceId = me.workspaceId;
    const member = await dataSource.getRepository(Member).save(
      dataSource.getRepository(Member).create({
        workspaceId,
        name: 'Hằng',
        email: `bob-${me.memberId}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'member',
        color: null,
      }),
    );
    bob = await tokenFor(member.id, workspaceId);
    const c1 = await createComputer(dataSource, workspaceId, {
      name: 'khanhpv-MacBook-Pro',
      simulated: true,
    });
    const c2 = await createComputer(dataSource, workspaceId, {
      name: 'build-box',
      status: 'offline',
      simulated: true,
    });
    a1 = await createAgent(dataSource, workspaceId, c1.id, { name: "khanhpv's Claude" });
    a2 = await createAgent(dataSource, workspaceId, c1.id, { name: 'Research Bot' });
    a3 = await createAgent(dataSource, workspaceId, c2.id, { name: 'Deployer' });
    const channel = await dataSource.getRepository(RoomRow).save(
      dataSource.getRepository(RoomRow).create({
        workspaceId,
        kind: 'channel',
        name: 'test',
        icon: 'hourglass',
        isPrivate: false,
        createdAt: clock.now(),
      }),
    );
    channelId = channel.id;
    await joinAll(dataSource, channel.id, [me.memberId, member.id], [a1.id, a2.id, a3.id]);
    // The thread "Hello": a root message of the channel (its id is the legacy thread id).
    threadId = (
      await dataSource.getRepository(ChatMessage).save(
        dataSource.getRepository(ChatMessage).create({
          workspaceId,
          roomId: channel.id,
          parentId: null,
          threadTitle: 'Hello',
          authorKind: 'human',
          authorMemberId: me.memberId,
          status: 'complete',
          markdown: 'Hello',
          draft: null,
          createdAt: new Date(clock.now().getTime() - 120_000),
        }),
      )
    ).id;
    // Both members have read the thread already (unread starts at 0).
    for (const memberId of [me.memberId, member.id]) {
      await dataSource.query(
        `INSERT INTO thread_reads (member_id, chat_id, last_read_seq)
         SELECT $1, $2, max(seq) FROM messages WHERE id = $2 OR parent_id = $2`,
        [memberId, threadId],
      );
    }
    realtime = [];
    ended = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.removeAllListeners(CHAT_RUN_ENDED_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
    emitter.on(CHAT_RUN_ENDED_EVENT, (e: ChatRunEndedPayload) => ended.push(e));
  });

  // ---------- helpers ----------
  const call = async <T>(
    method: 'get' | 'post',
    path: string,
    body?: object,
    expected = 200,
    client = me,
  ): Promise<T> => {
    const response = await request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(client.bearer)
      .send(body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const errorOf = async (
    method: 'get' | 'post',
    path: string,
    body: object | undefined,
    status: number,
    client = me,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(client.bearer)
      .send(body);
    expect(response.status).toBe(status);
    return (response.body as ApiResponse<null>).message;
  };

  const dmOf = async (agent: Agent, client = me): Promise<string> =>
    (await call<{ chatId: string }>('post', `/agents/${agent.id}/dm`, undefined, 200, client))
      .chatId;
  const send = (chatId: string, markdown: string, extra: object = {}, client = me) =>
    call<Message>('post', `/chats/${chatId}/messages`, { markdown, ...extra }, 200, client);
  const sendIn = async (chatId: string, markdown: string, lang: string) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(me.bearer)
      .set('Accept-Language', lang)
      .send({ markdown });
    expect(response.status).toBe(200);
    return (response.body as ApiResponse<Message>).data;
  };
  const messages = (chatId: string, client = me) =>
    call<Message[]>('get', `/chats/${chatId}/messages`, undefined, 200, client);
  const replies = async (chatId: string) =>
    (await messages(chatId)).filter((m) => m.author.kind === 'agent');
  const rooms = (client = me) => call<Room[]>('get', '/rooms', undefined, 200, client);

  /** Fires the manual timers one by one until the condition holds. */
  const drainUntil = async (done: () => boolean | Promise<boolean>): Promise<void> => {
    const started = Date.now();
    while (!(await done())) {
      if (Date.now() - started > 20_000) throw new Error('timed out draining chat timers');
      if (timers.pending.length) timers.pending.shift()!();
      await sleep(2);
    }
  };
  const replyDone = (chatId: string) => async () =>
    (await replies(chatId)).every((m) => m.status !== 'streaming');

  const open = (client: LoggedInClient): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/v1/events',
          headers: { Authorization: client.bearer.Authorization },
        },
        (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (buffer += chunk));
          const waitFor = (text: string, ms = 3000): Promise<void> =>
            new Promise((ok, fail) => {
              const started = Date.now();
              const tick = (): void => {
                if (buffer.includes(text)) return ok();
                if (Date.now() - started > ms)
                  return fail(new Error(`timeout waiting for ${text}`));
                setTimeout(tick, 10);
              };
              tick();
            });
          resolve({ chunks: () => buffer, waitFor, close: () => req.destroy() });
        },
      );
      req.on('error', reject);
    });

  // ---------- rooms and visibility ----------
  it('lists channels for everyone but a DM only for its member', async () => {
    const mine = await dmOf(a1);
    const his = await dmOf(a2, bob);

    const mineRooms = await rooms();
    expect(mineRooms.map((r) => r.id)).toEqual([mine, channelId]);
    expect(mineRooms[0]).toMatchObject({ kind: 'dm', agentId: a1.id, isPrivate: true });
    expect(mineRooms[1].threads.map((t) => t.id)).toEqual([threadId]);

    const bobRooms = await rooms(bob);
    expect(bobRooms.map((r) => r.id)).toEqual([his, channelId]);
  });

  it('hides a DM of another member and chats of another workspace (404)', async () => {
    const mine = await dmOf(a1);
    const stranger = await registerAndLogin(app);
    for (const client of [bob, stranger]) {
      expect(await errorOf('get', `/chats/${mine}`, undefined, 404, client)).toBe(
        `Chat ${mine} not found`,
      );
      await errorOf('get', `/chats/${mine}/messages`, undefined, 404, client);
      await errorOf('post', `/chats/${mine}/messages`, { markdown: 'hi' }, 404, client);
    }
    await errorOf('get', `/chats/${threadId}`, undefined, 404, stranger);
    await errorOf('get', '/chats/not-a-uuid', undefined, 404);
    // Reading something one cannot see is a silent no-op, never an event.
    realtime = [];
    await call('post', `/chats/${mine}/read`, undefined, 200, bob);
    expect(realtime).toEqual([]);
  });

  it('describes DM and thread chats', async () => {
    const mine = await dmOf(a1);
    expect(await call<Chat>('get', `/chats/${mine}`)).toEqual({
      id: mine,
      kind: 'dm',
      title: "khanhpv's Claude",
      subtitle: null,
      agentIds: [a1.id],
    });
    // Thread: every agent whose computer is not offline (Deployer's is).
    expect(await call<Chat>('get', `/chats/${threadId}`)).toEqual({
      id: threadId,
      kind: 'thread',
      title: 'Hello',
      subtitle: '# test',
      agentIds: [a1.id, a2.id],
    });
  });

  it('derives previews and last-message times from the last message', async () => {
    const mine = await dmOf(a1);
    const before = await rooms();
    expect(before[1]).toMatchObject({ id: channelId, preview: '' });
    expect(before[1].threads[0]).toMatchObject({ preview: 'Hello', unread: 0 });

    clock.advance(1000);
    const first = await send(threadId, '**Bold** and `code` here\nsecond line');
    clock.advance(1000);
    const last = await send(threadId, 'Plain `last` one');
    const after = await rooms();
    const thread = after.find((r) => r.id === channelId)!.threads[0];
    expect(thread.preview).toBe('Plain last one');
    expect(thread.lastMessageAt).toBe(last.createdAt);
    expect(first.markdown).toBe('**Bold** and `code` here\nsecond line');

    await send(mine, '**Hi** there\nsecond');
    // The agent's empty placeholder is the last message of the DM.
    const [placeholder] = await replies(mine);
    const dm = (await rooms()).find((r) => r.id === mine)!;
    expect(dm).toMatchObject({ preview: '', lastMessageAt: placeholder.createdAt });
    expect(dm.threads).toEqual([]);
  });

  it('counts unread messages of others per thread and resets on read', async () => {
    await send(threadId, 'hello from Hằng', {}, bob);
    await send(threadId, 'second', {}, bob);
    const thread = async (client: LoggedInClient) =>
      (await rooms(client)).find((r) => r.id === channelId)!.threads[0];
    expect((await thread(me)).unread).toBe(2);
    expect((await thread(bob)).unread).toBe(0); // own messages never count

    realtime = [];
    expect(await call('post', `/chats/${threadId}/read`)).toBeNull();
    expect((await thread(me)).unread).toBe(0);
    expect((await thread(bob)).unread).toBe(0);
    expect(realtime).toEqual([
      { workspaceId: me.workspaceId, event: { type: 'rooms.changed' }, memberIds: [me.memberId] },
    ]);

    clock.advance(1000);
    await send(threadId, 'again', {}, bob);
    expect((await thread(me)).unread).toBe(1);
    // an unknown chat is ignored
    expect(await call('post', `/chats/${NIL_UUID}/read`)).toBeNull();
  });

  // ---------- sending ----------
  it('rejects an empty message and an unknown agent', async () => {
    const mine = await dmOf(a1);
    expect(await errorOf('post', `/chats/${mine}/messages`, { markdown: '   \n ' }, 400)).toBe(
      'Message is empty',
    );
    expect(
      await errorOf('post', `/chats/${mine}/messages`, { markdown: 'hi', agentId: 'nope' }, 400),
    ).toBe('Unknown agent');
    const stranger = await registerAndLogin(app);
    const computer = await createComputer(dataSource, stranger.workspaceId);
    const foreign = await createAgent(dataSource, stranger.workspaceId, computer.id);
    expect(
      await errorOf(
        'post',
        `/chats/${mine}/messages`,
        { markdown: 'hi', agentId: foreign.id },
        400,
      ),
    ).toBe('Unknown agent');
    expect(await messages(mine)).toEqual([]);
    await errorOf('post', `/chats/${mine}/messages`, { markdown: 'x'.repeat(20_001) }, 400);
  });

  it('picks the agent: explicit, @mention, DM partner, nobody', async () => {
    const mine = await dmOf(a1);
    const agentOfLastReply = async (chatId: string) => (await replies(chatId)).at(-1)?.author;

    // explicit agent wins, even in a thread without any mention
    await send(threadId, 'please help', { agentId: a3.id });
    expect(await agentOfLastReply(threadId)).toEqual({ kind: 'agent', id: a3.id });

    // every @mentioned agent of the chat answers, in mention order
    const before = (await replies(threadId)).length;
    await send(threadId, "Hello @Research Bot and @khanhpv's Claude");
    expect((await replies(threadId)).slice(before).map((m) => m.author)).toEqual([
      { kind: 'agent', id: a2.id },
      { kind: 'agent', id: a1.id },
    ]);
    await send(threadId, 'Hello @Research Bot');
    expect(await agentOfLastReply(threadId)).toEqual({ kind: 'agent', id: a2.id });

    // mentions are case-insensitive, and must name an agent of the chat that is not offline
    const count = (await replies(threadId)).length;
    await send(threadId, 'hello @research bot');
    expect((await replies(threadId)).length).toBe(count + 1);
    await send(threadId, 'hello @Deployer (offline, so not in this thread)');
    await send(threadId, 'no mention at all');
    expect((await replies(threadId)).length).toBe(count + 1);

    // a DM answers with its partner, mention or not
    await send(mine, 'anything');
    expect(await agentOfLastReply(mine)).toEqual({ kind: 'agent', id: a1.id });
  });

  it('answers through a full simulated run: states, an honest demo reply streamed', async () => {
    const mine = await dmOf(a1);
    realtime = [];
    const human = await sendIn(mine, 'viết hàm sortBy giúp em', 'vi');
    expect(human).toMatchObject({ author: { kind: 'human', id: me.memberId }, status: 'complete' });
    expect(human.assignment).toBeNull();

    const placeholder = (await replies(mine))[0];
    expect(placeholder).toMatchObject({ status: 'streaming', markdown: '' });
    expect(placeholder.assignment).toMatchObject({ agentId: a1.id, status: 'pending', turns: 0 });

    // Streaming is memory only: while chunks are going out, the row stays empty.
    let midStreamRow: ChatMessage | null = null;
    await drainUntil(async () => {
      const streamed = frames(placeholder.id).filter((m) => m.markdown !== '');
      if (streamed.length >= 3 && !midStreamRow) {
        midStreamRow = await dataSource
          .getRepository(ChatMessage)
          .findOneBy({ id: placeholder.id });
      }
      return ended.length > 0;
    });
    expect(midStreamRow).toMatchObject({ markdown: '', status: 'streaming' });

    const seen = frames(placeholder.id);
    const statuses = [...new Set(seen.map((m) => m.assignment!.status))];
    expect(statuses).toEqual(['pending', 'offered', 'claimed', 'running', 'completed']);
    const growing = seen.filter((m) => m.markdown !== '' && m.status === 'streaming');
    expect(growing.length).toBeGreaterThan(5);
    growing.forEach((m, i) => {
      if (i) expect(m.markdown.startsWith(growing[i - 1].markdown)).toBe(true);
      if (i) expect(m.markdown.length).toBeGreaterThan(growing[i - 1].markdown.length);
    });
    expect(seen.at(-1)).toMatchObject({
      status: 'complete',
      markdown: DEMO_REPLIES.vi,
    });

    const [final] = await replies(mine);
    expect(final).toMatchObject({
      id: placeholder.id,
      status: 'complete',
      markdown: DEMO_REPLIES.vi,
    });
    expect(final.assignment).toMatchObject({ status: 'completed', turns: 1, error: null });
    // a demo agent shows no scripted tool calls
    expect(final.assignment!.toolCalls).toEqual([]);
    const row = await dataSource
      .getRepository(Assignment)
      .findOneByOrFail({ id: final.assignment!.id });
    expect(row).toMatchObject({
      sourceKind: 'chat',
      sourceId: placeholder.id,
      toolCalls: 0,
      turns: 1,
    });
    expect(await dataSource.getRepository(ChatMessage).count({ where: { roomId: mine } })).toBe(2);

    // the run is over: activity, domain event, derived agent status
    expect(ended).toEqual([
      {
        workspaceId: me.workspaceId,
        agentId: a1.id,
        ok: true,
        durationSec: 4,
        // a DM's text never leaves the DM
        preview: '',
        dm: true,
        privateRoom: false,
      },
    ]);
    expect(
      await dataSource.getRepository(AgentActivity).findOneByOrFail({ agentId: a1.id }),
    ).toMatchObject({ location: 'DM', request: 'Tin nhắn riêng (DM)', status: 'completed' });
    const agents = await call<{ id: string; status: string }[]>('get', '/agents');
    expect(agents.find((a) => a.id === a1.id)!.status).toBe('idle');
    expect(realtime.some((e) => e.event.type === 'agents.changed')).toBe(true);
  });

  /** Every `message.upserted` frame of one message, in publish order. */
  const frames = (messageId: string): Message[] =>
    realtime.flatMap((e) =>
      e.event.type === 'message.upserted' && e.event.message.id === messageId
        ? [e.event.message]
        : [],
    );

  it('shows the agent as working while a reply runs, and the other thread reply text', async () => {
    await sendIn(threadId, 'tóm tắt repo giúp em @Research Bot', 'vi');
    const [reply] = await replies(threadId);
    await drainUntil(async () => frames(reply.id).some((m) => m.assignment!.status === 'running'));
    const agents = await call<{ id: string; status: string }[]>('get', '/agents');
    expect(agents.find((a) => a.id === a2.id)!.status).toBe('working');
    await drainUntil(() => ended.length > 0);
    const [done] = await replies(threadId);
    expect(done.markdown).toBe(DEMO_REPLIES.vi);
    expect(done.assignment!.toolCalls).toEqual([]);
    expect(
      await dataSource.getRepository(AgentActivity).findOneByOrFail({ agentId: a2.id }),
    ).toMatchObject({ location: '# test › Hello', status: 'completed' });
  });

  it('answers in the fallback language (en) for text without Vietnamese letters, and never fails by chance', async () => {
    random.value = 0.05; // would have been the old 8 % failure roll
    const mine = await dmOf(a1);
    await send(mine, 'hello');
    await drainUntil(() => ended.length > 0);
    const [reply] = await replies(mine);
    expect(reply).toMatchObject({ status: 'complete', markdown: DEMO_REPLIES.en });
    expect(reply.assignment).toMatchObject({ status: 'completed', error: null });
    expect(ended[0]).toMatchObject({ ok: true, durationSec: 4 });
    expect(
      await dataSource.getRepository(AgentActivity).findOneByOrFail({ agentId: a1.id }),
    ).toMatchObject({ status: 'completed' });
  });

  it('answers in the request language (Accept-Language), whatever the message text', async () => {
    const mine = await dmOf(a1);
    await sendIn(mine, 'hello', 'vi');
    await drainUntil(() => ended.length > 0);
    expect((await replies(mine))[0]).toMatchObject({
      status: 'complete',
      markdown: DEMO_REPLIES.vi,
    });
    await sendIn(mine, 'xin chào', 'en');
    await drainUntil(() => ended.length > 1);
    expect((await replies(mine))[1]).toMatchObject({
      status: 'complete',
      markdown: DEMO_REPLIES.en,
    });
  });

  it('refuses a DM to an agent whose computer is offline instead of hanging', async () => {
    const mine = await dmOf(a3);
    expect(
      await errorOf('post', `/chats/${mine}/messages`, { markdown: 'deploy please' }, 409),
    ).toBe("This agent's computer is offline, so it cannot answer right now");
    // nothing was stored and nobody was woken
    expect(await messages(mine)).toEqual([]);
    expect(await dataSource.getRepository(Assignment).count()).toBe(0);
    await dataSource.query(`UPDATE computers SET status = 'online'`);
    await send(mine, 'deploy please');
  });

  it('expires the reply of an agent whose computer is offline (explicit agent in a thread)', async () => {
    await send(threadId, 'deploy please', { agentId: a3.id });
    await drainUntil(replyDone(threadId));
    const [reply] = await replies(threadId);
    expect(reply).toMatchObject({ status: 'failed', markdown: '' });
    expect(reply.assignment).toMatchObject({
      status: 'expired',
      error: 'build-box offline, không có máy nhận việc',
    });
    expect(ended).toEqual([]);
  });

  it('keeps DM text out of workspace-visible rows (activity log and dashboard feed)', async () => {
    // the spec drops every CHAT_RUN_ENDED listener in beforeEach: bring the dashboard's back
    const dashboard = app.get(DashboardService);
    emitter.on(CHAT_RUN_ENDED_EVENT, (e: ChatRunEndedPayload) => void dashboard.onChatRunEnded(e));
    const secret = 'zebra-passphrase-4711';
    const mine = await dmOf(a1);
    await send(mine, `please keep ${secret} private`);
    await drainUntil(replyDone(mine));
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ dm: true, preview: '' });

    const feedOf = async () =>
      (await call<{ feed: { text: string }[] }>('get', '/dashboard', undefined, 200, bob)).feed;
    const started = Date.now();
    while (!(await feedOf()).length && Date.now() - started < 3000) await sleep(20);
    const feed = await feedOf();
    expect(feed.map((item) => item.text)).toEqual([expect.stringMatching(/trả lời trong DM$/)]);
    const dashboardBody = JSON.stringify(await call('get', '/dashboard', undefined, 200, bob));
    const activityBody = JSON.stringify(
      await call('get', `/agents/${a1.id}/activity`, undefined, 200, bob),
    );
    expect(dashboardBody).not.toContain(secret);
    expect(activityBody).not.toContain(secret);
    expect(activityBody).toContain('Tin nhắn riêng (DM)');
    // the DM owner still sees the text in the DM itself
    expect(JSON.stringify(await messages(mine))).toContain(secret);
  });

  it('rejects an explicit agent that is not the DM partner', async () => {
    const mine = await dmOf(a1);
    expect(
      await errorOf('post', `/chats/${mine}/messages`, { markdown: 'hi', agentId: a2.id }, 400),
    ).toBe('Unknown agent');
    // the partner itself is fine; a thread still accepts any agent of the workspace
    await send(mine, 'hi', { agentId: a1.id });
    await send(threadId, 'hi', { agentId: a2.id });
  });

  it('fails the replies that were in flight when the server restarted', async () => {
    // a real computer's reply is offered to its daemon right away; the simulator ignores it
    await dataSource.query(`UPDATE computers SET simulated = false`);
    const mine = await dmOf(a1);
    await send(mine, 'hello');
    const [pending] = await replies(mine);
    expect(pending.assignment!.status).toBe('offered');
    // only assignments of simulated computers are cleaned up
    expect(await chat.failStaleReplies()).toBe(0);
    await dataSource.query(`UPDATE computers SET simulated = true`);
    expect(await chat.failStaleReplies()).toBe(1);
    const [after] = await replies(mine);
    expect(after).toMatchObject({ status: 'failed' });
    expect(after.assignment).toMatchObject({ status: 'expired' });
    expect(after.assignment!.error).toContain('restarted');
    expect(await chat.failStaleReplies()).toBe(0);
    // a runner that wakes up late finds nothing to drive and does not throw
    await drainUntil(async () => !timers.pending.length);
  });

  // ---------- gateway support for chat runs ----------
  it('records tool calls by id, turns, and expires assignments through the gateway', async () => {
    const gateway = app.get(AgentGatewayService);
    const make = () =>
      gateway.create({
        workspaceId: me.workspaceId,
        agentId: a1.id,
        sourceKind: 'chat',
        sourceId: NIL_UUID,
      });
    const created = await make();
    await gateway.offer(created.id);
    // claimById targets exactly one assignment, on its own computer only
    await expect(gateway.claimById(created.id, a3.computerId)).rejects.toThrow();
    const claimed = await gateway.claimById(created.id, a1.computerId);
    expect(claimed).toMatchObject({ status: 'claimed', attempt: 1 });
    await gateway.accept(created.id, claimed.attempt);

    const call = {
      id: 'tc-1',
      name: 'Bash',
      input: 'ls',
      output: null,
      status: 'running' as const,
    };
    await gateway.progress(created.id, 1, [{ kind: 'tool', payload: call }]);
    await gateway.progress(created.id, 1, [
      { kind: 'tool', payload: { ...call, output: 'a', status: 'ok' as const } },
      {
        kind: 'tool',
        payload: { id: 'tc-2', name: 'Read', input: 'x', output: null, status: 'running' },
      },
      { kind: 'step', payload: { turns: 2 } },
      { kind: 'text' },
    ]);
    const row = await dataSource.getRepository(Assignment).findOneByOrFail({ id: created.id });
    expect(row.toolCalls).toBe(2);
    expect(row.turns).toBe(2);
    expect(row.toolLog.map((t) => [t.id, t.status])).toEqual([
      ['tc-1', 'ok'],
      ['tc-2', 'running'],
    ]);
    // a task step (no id) only counts
    await gateway.progress(created.id, 1, [
      { kind: 'tool', payload: { tool: 'Bash', input: 'x' } },
    ]);
    expect(
      (await dataSource.getRepository(Assignment).findOneByOrFail({ id: created.id })).toolCalls,
    ).toBe(3);

    const expired = await gateway.expire(created.id, 'no computer');
    expect(expired).toMatchObject({ status: 'expired', error: 'no computer' });
    await expect(gateway.expire(created.id, 'again')).rejects.toThrow();
  });

  // ---------- DMs ----------
  it('creates one DM per member and agent, also under parallel calls', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => dmOf(a1)));
    expect(new Set(ids).size).toBe(1);
    const bobs = await dmOf(a1, bob);
    expect(bobs).not.toBe(ids[0]);
    expect(await dataSource.getRepository(RoomRow).count({ where: { kind: 'dm' } })).toBe(2);
    expect(await dmOf(a1)).toBe(ids[0]);

    const stranger = await registerAndLogin(app);
    expect(await errorOf('post', `/agents/${a1.id}/dm`, undefined, 404, stranger)).toBe(
      'Agent not found',
    );
    await errorOf('post', '/agents/not-a-uuid/dm', undefined, 404);
  });

  it('links a task assigned to an agent to the creator DM', async () => {
    const created = await call<Task>('post', '/tasks', { title: 'Viết docs', assigneeId: a1.id });
    const dm = await dmOf(a1);
    expect(created.chatId).toBe(dm);
    const second = await call<Task>('post', '/tasks', { title: 'Another', assigneeId: a1.id });
    expect(second.chatId).toBe(dm);

    const unassigned = await call<Task>('post', '/tasks', { title: 'Later' });
    expect(unassigned.chatId).toBeNull();
    const patched = await call<Task>('post', `/tasks/${unassigned.id}/move`, { status: 'backlog' });
    expect(patched.chatId).toBeNull();

    const reassigned = await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${unassigned.id}`)
      .set(bob.bearer)
      .send({ assigneeId: a2.id });
    expect(reassigned.status).toBe(200);
    const bobsDm = await dmOf(a2, bob);
    expect((reassigned.body as ApiResponse<Task>).data.chatId).toBe(bobsDm);
  });

  // ---------- messages ----------
  it('returns the latest 200 messages, oldest first', async () => {
    const repo = dataSource.getRepository(ChatMessage);
    const base = clock.now().getTime();
    for (let i = 0; i < 205; i++) {
      await repo.insert({
        workspaceId: me.workspaceId,
        roomId: channelId,
        parentId: threadId,
        authorKind: 'human',
        authorMemberId: me.memberId,
        status: 'complete',
        markdown: `m${i}`,
        draft: null,
        createdAt: new Date(base + i),
      });
    }
    const list = await messages(threadId);
    expect(list).toHaveLength(200);
    expect(list[0].markdown).toBe('m5');
    expect(list.at(-1)!.markdown).toBe('m204');
  });

  // ---------- drafts ----------
  it('sends a draft: only its state changes', async () => {
    const repo = dataSource.getRepository(ChatMessage);
    const plain = await send(threadId, 'no draft here');
    expect(await errorOf('post', `/messages/${plain.id}/send-draft`, undefined, 404)).toBe(
      'Draft not found',
    );
    await errorOf('post', `/messages/${NIL_UUID}/send-draft`, undefined, 404);
    await errorOf('post', '/messages/nope/send-draft', undefined, 404);

    const draft = await repo.save(
      repo.create({
        workspaceId: me.workspaceId,
        roomId: channelId,
        parentId: threadId,
        authorKind: 'agent',
        authorAgentId: a1.id,
        status: 'complete',
        markdown: 'Dạ chào chị Lan',
        draft: { connectionId: 'zalo', state: 'pending' },
        createdAt: clock.now(),
      }),
    );
    realtime = [];
    const sent = await call<Message>(
      'post',
      `/messages/${draft.id}/send-draft`,
      undefined,
      200,
      bob,
    );
    expect(sent).toMatchObject({
      id: draft.id,
      markdown: 'Dạ chào chị Lan',
      status: 'complete',
      draft: { connectionId: 'zalo', state: 'sent' },
    });
    expect(frames(draft.id)).toHaveLength(1);
    expect((await messages(threadId)).find((m) => m.id === draft.id)!.draft!.state).toBe('sent');

    // a draft inside somebody else's DM is not visible
    const mine = await dmOf(a1);
    const hidden = await repo.save(
      repo.create({
        workspaceId: me.workspaceId,
        roomId: mine,
        authorKind: 'agent',
        authorAgentId: a1.id,
        status: 'complete',
        markdown: 'secret',
        draft: { connectionId: 'zalo', state: 'pending' },
        createdAt: clock.now(),
      }),
    );
    await errorOf('post', `/messages/${hidden.id}/send-draft`, undefined, 404, bob);
    await call('post', `/messages/${hidden.id}/send-draft`);
  });

  // ---------- realtime privacy ----------
  it('delivers DM events only to the DM owner (fail-closed), thread events to everyone', async () => {
    const mine = await dmOf(a1);
    const mineStream = await open(me);
    const bobStream = await open(bob);
    try {
      await send(mine, 'my private question');
      await send(threadId, 'public question');
      events.publish(me.workspaceId, { type: 'tasks.changed' }, { memberIds: [] });
      events.publish(me.workspaceId, { type: 'computers.changed' });
      await mineStream.waitFor('computers.changed');
      await bobStream.waitFor('computers.changed');

      const mineFrames = mineStream.chunks();
      const bobFrames = bobStream.chunks();
      expect(mineFrames).toContain('my private question');
      expect(mineFrames).toContain('public question');
      expect(bobFrames).toContain('public question');
      expect(bobFrames).not.toContain('my private question');
      // the agent placeholder of the DM is private as well: bob sees no DM chat id at all
      expect(bobFrames).not.toContain(mine);
      expect(mineFrames).toContain(mine);
      // an empty audience reaches nobody
      expect(mineFrames).not.toContain('tasks.changed');
      expect(bobFrames).not.toContain('tasks.changed');
    } finally {
      mineStream.close();
      bobStream.close();
    }
  });

  it('keeps the private part of a DM run (streaming frames) off other members streams', async () => {
    const mine = await dmOf(a1);
    const bobStream = await open(bob);
    try {
      await send(mine, 'hello there');
      await drainUntil(() => ended.length > 0);
      events.publish(me.workspaceId, { type: 'computers.changed' });
      await bobStream.waitFor('computers.changed');
      expect(bobStream.chunks()).not.toContain('message.upserted');
      // the neutral pings of the run still reach him
      expect(bobStream.chunks()).toContain('agents.changed');
    } finally {
      bobStream.close();
    }
  });
});

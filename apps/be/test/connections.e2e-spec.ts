import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, Chat, Connection, Message, Room } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REALTIME_EVENT, RealtimeEnvelope } from '../src/modules/events';
import {
  CONNECTION_CATALOG,
  CONNECTION_SAMPLES,
} from '../src/modules/connections/connection-catalog';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { TaskTimers } from '../src/modules/tasks/task-timers';
import {
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  truncateAll,
} from './utils';

/** Timers that only run when the test fires them (the 1.5 s OAuth wait). */
class ManualTimers extends TaskTimers {
  pending: { ms: number; fn: () => void }[] = [];
  override later(ms: number, fn: () => void): void {
    this.pending.push({ ms, fn });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Connections (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;
  const timers = new ManualTimers();
  let me: LoggedInClient;
  let sales: Agent;
  let other: Agent;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(TaskTimers).useValue(timers),
    ));
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    timers.pending = [];
    me = await registerAndLogin(app);
    const pc = await createComputer(dataSource, me.workspaceId);
    sales = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'Sales Bot' });
    other = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'Other Bot' });
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
  });

  // ---------- helpers ----------
  const send = (method: 'get' | 'post' | 'delete', path: string, body?: object, client = me) =>
    request(app.getHttpServer())[method](`/api/v1${path}`).set(client.bearer).send(body);
  const call = async <T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: object,
    expected = 200,
    client = me,
  ): Promise<T> => {
    const response = await send(method, path, body, client);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const list = (client = me) => call<Connection[]>('get', '/connections', undefined, 200, client);
  const rooms = (client = me) => call<Room[]>('get', '/rooms', undefined, 200, client);
  const connect = (id: string, body: Partial<Record<string, unknown>> = {}, client = me) =>
    call<Connection>(
      'post',
      `/connections/${id}/connect`,
      { account: 'Holatech OA', roomName: 'zalo-inbox', agentId: sales.id, mode: 'draft', ...body },
      200,
      client,
    );
  const inboxOf = async (id: string, client = me) =>
    (await rooms(client)).find((room) => room.threads.some((t) => t.connectionId === id));
  const types = () => realtime.map((e) => e.event.type);

  describe('GET /connections', () => {
    it('lists the catalog in order, all off with defaults', async () => {
      const connections = await list();
      expect(connections.map((c) => c.id)).toEqual(['zalo', 'facebook', 'gmail']);
      for (const connection of connections) {
        expect(connection).toMatchObject({
          status: 'off',
          account: null,
          roomId: null,
          agentId: null,
          mode: 'draft',
        });
      }
      expect(connections[0]).toMatchObject({
        name: 'Zalo OA',
        shortName: 'Zalo',
        color: '#0068ff',
        roomName: 'zalo-inbox',
        accountLabel: 'Official Account',
        capabilities: ['Tin nhắn OA', 'Trả lời khách', 'Người quan tâm'],
        permissions: [
          'Đọc tin nhắn gửi tới Official Account',
          'Gửi tin nhắn trả lời thay OA',
          'Xem tên và ảnh đại diện người quan tâm',
        ],
      });
      expect(connections[0].accounts).toEqual([
        { name: 'Holatech OA', detail: '1.240 người quan tâm' },
        { name: 'Hola Shop', detail: '386 người quan tâm' },
      ]);
      expect(connections[1]).toMatchObject({
        name: 'Facebook Messenger',
        roomName: 'facebook-inbox',
      });
      expect(connections[2]).toMatchObject({
        name: 'Gmail',
        shortName: 'Google',
        accounts: [{ name: 'khanhpv@holatech.tech', detail: 'Google Workspace' }],
      });
      expect(CONNECTION_CATALOG).toHaveLength(3);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/connections').expect(401);
      await request(app.getHttpServer()).post('/api/v1/connections/zalo/authorize').expect(401);
    });
  });

  describe('POST /connections/:id/authorize', () => {
    it('answers ok only after the simulated 1.5 s round trip', async () => {
      let done = false;
      const response = send('post', '/connections/zalo/authorize').then((r) => {
        done = true;
        return r;
      });
      while (!timers.pending.length) await sleep(5);
      expect(timers.pending).toHaveLength(1);
      expect(timers.pending[0].ms).toBe(1500);
      await sleep(30);
      expect(done).toBe(false);
      timers.pending[0].fn();
      const result = await response;
      expect(result.status).toBe(200);
      expect((result.body as ApiResponse<{ ok: boolean }>).data).toEqual({ ok: true });
    });

    it('answers 404 for an unknown provider without waiting', async () => {
      const response = await send('post', '/connections/slack/authorize');
      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe('Connection slack not found');
      expect(timers.pending).toHaveLength(0);
    });
  });

  describe('POST /connections/:id/connect', () => {
    it('creates the inbox room, thread and sample conversation once', async () => {
      const connection = await connect('zalo');
      expect(connection).toMatchObject({
        id: 'zalo',
        status: 'on',
        account: 'Holatech OA',
        roomName: 'zalo-inbox',
        agentId: sales.id,
        mode: 'draft',
      });
      expect(connection.roomId).toEqual(expect.any(String));

      const room = (await inboxOf('zalo'))!;
      expect(room).toMatchObject({
        id: connection.roomId,
        kind: 'channel',
        name: 'zalo-inbox',
        icon: 'inbox',
        isPrivate: false,
        agentId: null,
      });
      expect(room.threads).toHaveLength(1);
      const thread = room.threads[0];
      expect(thread).toMatchObject({
        name: 'Nguyễn Lan',
        connectionId: 'zalo',
        unread: 2,
        preview: CONNECTION_SAMPLES.zalo.reply.replace(/\*\*/g, ''),
      });

      const messages = await call<Message[]>('get', `/chats/${thread.id}/messages`);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        author: { kind: 'external', connectionId: 'zalo', name: 'Nguyễn Lan' },
        markdown: CONNECTION_SAMPLES.zalo.text,
        status: 'complete',
        draft: null,
      });
      expect(messages[1]).toMatchObject({
        author: { kind: 'agent', id: sales.id },
        markdown: CONNECTION_SAMPLES.zalo.reply,
        draft: { connectionId: 'zalo', state: 'pending' },
      });
      expect((await list())[0]).toMatchObject({ status: 'on', roomId: room.id });
    });

    it('uses the exact sample texts of the other providers', async () => {
      await connect('facebook', { roomName: 'facebook-inbox' });
      await connect('gmail', { roomName: '' });
      const fb = (await inboxOf('facebook'))!;
      const gm = (await inboxOf('gmail'))!;
      expect(gm.name).toBe('gmail-inbox');
      expect(fb.threads[0].name).toBe('Trần Huy');
      expect(gm.threads[0].name).toBe('Phòng kế toán');
      const [ext] = await call<Message[]>('get', `/chats/${gm.threads[0].id}/messages`);
      expect(ext.markdown).toBe(
        '**Re: Hoá đơn tháng 9**\nAnh gửi giúp em bản xác nhận thanh toán AWS tháng 9 trước thứ Sáu nhé.',
      );
    });

    it('sends the draft reply right away in auto mode', async () => {
      await connect('zalo', { mode: 'auto' });
      const room = (await inboxOf('zalo'))!;
      const messages = await call<Message[]>('get', `/chats/${room.threads[0].id}/messages`);
      expect(messages[1].draft).toEqual({ connectionId: 'zalo', state: 'sent' });
    });

    it('normalizes the room name: one leading #, trimmed, default when empty', async () => {
      expect((await connect('zalo', { roomName: '  #sales  ' })).roomName).toBe('sales');
      await call('delete', '/connections/zalo');
      expect((await connect('zalo', { roomName: '   ' })).roomName).toBe('zalo-inbox');
    });

    it('records the connection in the dashboard feed and announces the change', async () => {
      await connect('zalo', { roomName: '#sales' });
      expect(types()).toEqual(
        expect.arrayContaining([
          'connections.changed',
          'rooms.changed',
          'message.upserted',
          'dashboard.changed',
        ]),
      );
      expect(types().filter((t) => t === 'message.upserted')).toHaveLength(2);
      const dashboard = await call<{ feed: { by: string; text: string }[] }>('get', '/dashboard');
      expect(dashboard.feed[0]).toEqual(
        expect.objectContaining({ by: me.memberId, text: 'kết nối **Zalo OA** vào **#sales**' }),
      );
    });

    it('connecting again only updates the settings', async () => {
      const first = await connect('zalo');
      realtime = [];
      const second = await connect('zalo', {
        account: 'Hola Shop',
        roomName: 'support',
        agentId: other.id,
        mode: 'auto',
      });
      expect(second).toMatchObject({
        roomId: first.roomId,
        account: 'Hola Shop',
        roomName: 'support',
        agentId: other.id,
        mode: 'auto',
      });
      const all = await rooms();
      expect(all.filter((r) => r.icon === 'inbox')).toHaveLength(1);
      expect(all.find((r) => r.id === first.roomId)).toMatchObject({ name: 'support' });
      const room = (await inboxOf('zalo'))!;
      expect(room.threads).toHaveLength(1);
      const messages = await call<Message[]>('get', `/chats/${room.threads[0].id}/messages`);
      expect(messages).toHaveLength(2);
      // The draft keeps its state: a new mode only affects future conversations.
      expect(messages[1].draft?.state).toBe('pending');
      expect(types()).not.toContain('message.upserted');
      const { feed } = await call<{ feed: { text: string }[] }>('get', '/dashboard');
      expect(feed.filter((f) => f.text.startsWith('kết nối'))).toHaveLength(1);
    });

    it('rejects an unknown agent with 400', async () => {
      const foreign = await registerAndLogin(app);
      const foreignAgent = await createAgent(
        dataSource,
        foreign.workspaceId,
        (await createComputer(dataSource, foreign.workspaceId)).id,
      );
      for (const agentId of ['nope', randomUUID(), foreignAgent.id]) {
        const response = await send('post', '/connections/zalo/connect', {
          account: 'a',
          roomName: 'r',
          agentId,
          mode: 'draft',
        });
        expect(response.status).toBe(400);
        expect((response.body as { message: string }).message).toBe('Unknown agent');
      }
      expect((await list())[0].status).toBe('off');
      expect(await inboxOf('zalo')).toBeUndefined();
    });

    it('validates the body', async () => {
      const base = { account: 'a', roomName: 'r', agentId: sales.id, mode: 'draft' };
      for (const bad of [
        { ...base, mode: 'later' },
        { ...base, roomName: 'x'.repeat(81) },
        { ...base, account: 'x'.repeat(201) },
        { ...base, agentId: undefined },
      ]) {
        const response = await send('post', '/connections/zalo/connect', bad);
        expect(response.status).toBe(400);
      }
      await connect('zalo', { roomName: 'x'.repeat(80) });
    });

    it('answers 404 for an unknown provider', async () => {
      const response = await send('post', '/connections/slack/connect', {
        account: 'a',
        roomName: 'r',
        agentId: sales.id,
        mode: 'draft',
      });
      expect(response.status).toBe(404);
      expect((await send('delete', '/connections/slack')).status).toBe(404);
    });
  });

  describe('chat of a connected thread', () => {
    it('is answered by the connection agent only', async () => {
      await connect('zalo');
      const thread = (await inboxOf('zalo'))!.threads[0];
      const chat = await call<Chat>('get', `/chats/${thread.id}`);
      expect(chat).toMatchObject({ kind: 'thread', title: 'Nguyễn Lan', subtitle: '# zalo-inbox' });
      expect(chat.agentIds).toEqual([sales.id]);

      // Mentioning an agent that is not the connection's wakes nobody.
      await call('post', `/chats/${thread.id}/messages`, { markdown: 'hi @Other Bot' });
      expect(
        await dataSource.getRepository(Assignment).count({ where: { agentId: other.id } }),
      ).toBe(0);
      await call('post', `/chats/${thread.id}/messages`, { markdown: 'hi @Sales Bot' });
      expect(
        await dataSource.getRepository(Assignment).count({ where: { agentId: sales.id } }),
      ).toBe(1);
    });

    it('follows the agent when the connection is reconnected with another one', async () => {
      await connect('zalo');
      await connect('zalo', { agentId: other.id });
      const thread = (await inboxOf('zalo'))!.threads[0];
      expect((await call<Chat>('get', `/chats/${thread.id}`)).agentIds).toEqual([other.id]);
    });
  });

  describe('DELETE /connections/:id', () => {
    it('turns it off and deletes the room, threads, messages and read marks', async () => {
      const connected = await connect('zalo', { account: 'Hola Shop', mode: 'auto' });
      const thread = (await inboxOf('zalo'))!.threads[0];
      await call('post', `/chats/${thread.id}/read`);
      realtime = [];

      const connection = await call<Connection>('delete', '/connections/zalo');
      expect(connection).toMatchObject({
        id: 'zalo',
        status: 'off',
        account: null,
        roomId: null,
        agentId: sales.id,
        mode: 'auto',
        roomName: 'zalo-inbox',
      });
      expect(await inboxOf('zalo')).toBeUndefined();
      expect((await rooms()).some((r) => r.id === connected.roomId)).toBe(false);
      const count = async (table: string) =>
        Number(
          ((await dataSource.query(`SELECT count(*) FROM ${table}`)) as { count: string }[])[0]
            .count,
        );
      expect(await count('threads')).toBe(0);
      expect(await count('messages')).toBe(0);
      expect(await count('thread_reads')).toBe(0);
      expect(types()).toEqual(expect.arrayContaining(['connections.changed', 'rooms.changed']));
      expect((await send('get', `/chats/${thread.id}/messages`)).status).toBe(404);

      // Connecting again starts a fresh conversation.
      await connect('zalo');
      const fresh = (await inboxOf('zalo'))!.threads[0];
      expect(fresh.id).not.toBe(thread.id);
      expect(await call<Message[]>('get', `/chats/${fresh.id}/messages`)).toHaveLength(2);
    });

    it('is a no-op for a provider that was never connected', async () => {
      const connection = await call<Connection>('delete', '/connections/gmail');
      expect(connection).toMatchObject({ id: 'gmail', status: 'off', roomId: null });
    });
  });

  describe('workspace isolation', () => {
    it('keeps connections, rooms and messages per workspace', async () => {
      await connect('zalo');
      const bob = await registerAndLogin(app);
      expect((await list(bob)).every((c) => c.status === 'off')).toBe(true);
      expect(await inboxOf('zalo', bob)).toBeUndefined();
      const thread = (await inboxOf('zalo'))!.threads[0];
      expect((await send('get', `/chats/${thread.id}/messages`, undefined, bob)).status).toBe(404);

      await call('delete', '/connections/zalo', undefined, 200, bob);
      expect((await list())[0].status).toBe('on');
      expect(await inboxOf('zalo')).toBeDefined();
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { App } from 'supertest/types';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { EventsService, REALTIME_EVENT } from '../src/modules/events';
import {
  createTestApp,
  LoggedInClient,
  mintAccessToken,
  registerAndLogin,
  truncateAll,
} from './utils';

interface Stream {
  res: http.IncomingMessage;
  chunks: () => string;
  waitFor: (text: string, ms?: number) => Promise<void>;
  ended: Promise<void>;
  close: () => void;
}

describe('Events SSE (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let events: EventsService;
  let emitter: EventEmitter2;
  let me: LoggedInClient;
  let other: LoggedInClient;
  let port: number;

  beforeAll(async () => {
    process.env.SSE_HEARTBEAT_MS = '100';
    ({ app, dataSource } = await createTestApp());
    await app.listen(0);
    port = ((app.getHttpServer() as unknown as http.Server).address() as AddressInfo).port;
    events = app.get(EventsService);
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.SSE_HEARTBEAT_MS;
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
    other = await registerAndLogin(app);
  });

  const open = (token: string, targetPort: number = port): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: targetPort,
          path: '/api/v1/events',
          headers: { Authorization: `Bearer ${token}` },
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
          const ended = new Promise<void>((done) => {
            res.on('end', () => done());
            res.on('close', () => done());
          });
          resolve({ res, chunks: () => buffer, waitFor, ended, close: () => req.destroy() });
        },
      );
      req.on('error', reject);
    });

  it('rejects a missing token with the JSON error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/events').expect(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it('rejects invalid and expired tokens with 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/events')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
    const expired = await new JwtService().signAsync(
      {
        sub: me.memberId,
        wid: me.workspaceId,
        role: 'owner',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      { secret: process.env.JWT_ACCESS_SECRET },
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/events')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it('streams only events of the caller workspace, with SSE headers and ids', async () => {
    const stream = await open(me.accessToken);
    try {
      expect(stream.res.statusCode).toBe(200);
      expect(stream.res.headers['content-type']).toContain('text/event-stream');
      expect(stream.res.headers['x-accel-buffering']).toBe('no');
      expect(stream.res.headers['cache-control']).toContain('no-cache');

      events.publish(other.workspaceId, { type: 'tasks.changed' });
      events.publish(me.workspaceId, { type: 'computers.changed' });
      events.publish(me.workspaceId, { type: 'agents.changed' });
      await stream.waitFor('agents.changed');

      const body = stream.chunks();
      expect(body).toContain('id: 1\ndata: {"type":"computers.changed"}\n\n');
      expect(body).toContain('id: 2\ndata: {"type":"agents.changed"}\n\n');
      expect(body).not.toContain('tasks.changed');
    } finally {
      stream.close();
    }
  });

  it('sends heartbeat comments', async () => {
    const stream = await open(me.accessToken);
    try {
      await stream.waitFor(': ping\n\n');
    } finally {
      stream.close();
    }
  });

  it('ends the stream when its access token expires and frees its registry entry', async () => {
    const baseline = events.openStreamCount;
    const token = await mintAccessToken(
      dataSource,
      { memberId: me.memberId, workspaceId: me.workspaceId, role: 'owner' },
      2,
    );
    const stream = await open(token);
    expect(events.openStreamCount).toBe(baseline + 1);
    const started = Date.now();
    await Promise.race([
      stream.ended,
      new Promise((_, fail) =>
        setTimeout(() => fail(new Error('stream outlived its token')), 10_000),
      ),
    ]);
    // generous: the token lives 2 s; this only proves the stream is cut by it, not hung on
    expect(Date.now() - started).toBeLessThan(9000);
    expect(events.openStreamCount).toBe(baseline);
  });

  it('removes the listener when the client disconnects', async () => {
    const baseline = emitter.listenerCount(REALTIME_EVENT);
    const stream = await open(me.accessToken);
    expect(emitter.listenerCount(REALTIME_EVENT)).toBe(baseline + 1);
    stream.close();
    const started = Date.now();
    while (emitter.listenerCount(REALTIME_EVENT) !== baseline && Date.now() - started < 3000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(emitter.listenerCount(REALTIME_EVENT)).toBe(baseline);
  });
  it('stops the heartbeat timer and registry entry after the client closes', async () => {
    const created: unknown[] = [];
    const cleared = new Set<unknown>();
    const realSet = global.setInterval;
    const realClear = global.clearInterval;
    global.setInterval = ((fn: () => void, ms?: number) => {
      const handle = realSet(fn, ms);
      if (ms === 100) created.push(handle);
      return handle;
    }) as typeof setInterval;
    global.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
      cleared.add(handle);
      realClear(handle);
    }) as typeof clearInterval;
    try {
      const baseline = events.openStreamCount;
      const stream = await open(me.accessToken);
      expect(events.openStreamCount).toBe(baseline + 1);
      expect(created).toHaveLength(1);
      stream.close();
      const started = Date.now();
      while (events.openStreamCount !== baseline && Date.now() - started < 3000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(events.openStreamCount).toBe(baseline);
      expect(cleared.has(created[0])).toBe(true);
    } finally {
      global.setInterval = realSet;
      global.clearInterval = realClear;
    }
  });

  it('a stream whose write throws is dropped without breaking publish for others', async () => {
    const broken = await open(me.accessToken);
    const healthy = await open(me.accessToken);
    const baseline = emitter.listenerCount(REALTIME_EVENT);
    const realWrite = http.ServerResponse.prototype.write;
    let thrown = 0;
    http.ServerResponse.prototype.write = function (
      this: http.ServerResponse,
      ...args: Parameters<typeof realWrite>
    ) {
      if (thrown === 0 && String(args[0]).includes('tasks.changed')) {
        thrown += 1;
        throw new Error('boom');
      }
      return realWrite.apply(this, args);
    } as typeof realWrite;
    try {
      expect(() => events.publish(me.workspaceId, { type: 'tasks.changed' })).not.toThrow();
      await healthy.waitFor('tasks.changed');
      expect(thrown).toBe(1);
      expect(emitter.listenerCount(REALTIME_EVENT)).toBe(baseline - 1);
      await broken.ended;
    } finally {
      http.ServerResponse.prototype.write = realWrite;
      broken.close();
      healthy.close();
    }
  });

  it('ends open streams on application shutdown', async () => {
    const second = await createTestApp();
    await second.app.listen(0);
    const secondPort = (
      (second.app.getHttpServer() as unknown as http.Server).address() as AddressInfo
    ).port;
    const secondEvents = second.app.get(EventsService);
    const stream = await open(me.accessToken, secondPort);
    expect(secondEvents.openStreamCount).toBe(1);
    await second.app.close();
    await stream.ended;
    expect(secondEvents.openStreamCount).toBe(0);
    stream.close();
  });
});

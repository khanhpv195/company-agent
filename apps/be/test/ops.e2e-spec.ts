import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ApiErrorResponse, ApiResponse } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { LOW_API_LIMIT as LIMIT } from './utils/low-api-throttle-env';
import { createTestApp, LoggedInClient, registerAndLogin, truncateAll } from './utils';

const api = (path: string) => `/api/v1${path}`;

describe('Production ops (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const http = () => request(app.getHttpServer());

  /** Buckets live in memory: forget what setup requests used so each test starts at zero. */
  const resetLimits = (): void => {
    const storage = app.get<{
      storage: Map<string, unknown>;
      hitExpirations: Map<string, unknown>;
    }>(ThrottlerStorage);
    storage.storage.clear();
    storage.hitExpirations.clear();
  };

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    resetLimits();
  });

  describe('request ids', () => {
    it('echoes a safe x-request-id and puts it in the error envelope', async () => {
      const res = await http().get(api('/nope')).set('x-request-id', 'req-abc.123').expect(404);
      expect(res.headers['x-request-id']).toBe('req-abc.123');
      const body = res.body as ApiErrorResponse;
      expect(body.meta?.requestId).toBe('req-abc.123');
    });

    it('generates an id when none is sent and replaces an unsafe one', async () => {
      const generated = await http().get(api('/health')).expect(200);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const unsafe = await http().get(api('/nope')).set('x-request-id', 'a b\tc').expect(404);
      const id = unsafe.headers['x-request-id'] as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect((unsafe.body as ApiErrorResponse).meta?.requestId).toBe(id);
    });
  });

  describe('readiness', () => {
    it('GET /health/ready checks the database', async () => {
      const res = await http().get(api('/health/ready')).expect(200);
      expect(res.body).toEqual({ status: 'ok', db: 'up' });
    });
  });

  describe('global throttling', () => {
    let alice: LoggedInClient;
    let bob: LoggedInClient;

    beforeEach(async () => {
      alice = await registerAndLogin(app);
      bob = await registerAndLogin(app);
      resetLimits();
    });

    it('limits a member across all routes with the standard 429 envelope', async () => {
      const routes = ['/session', '/members', '/computers'];
      for (let i = 0; i < LIMIT; i++) {
        await http()
          .get(api(routes[i % routes.length]))
          .set(alice.bearer)
          .expect(200);
      }
      const limited = await http().get(api('/session')).set(alice.bearer).expect(429);
      expect(limited.body).toMatchObject({
        success: false,
        data: null,
        message: 'Too many requests, please slow down',
        meta: { statusCode: 429, path: '/api/v1/session' },
      });
      expect(limited.headers['retry-after']).toBeDefined();
      // Keyed by member: another member of the same address is unaffected.
      await http().get(api('/session')).set(bob.bearer).expect(200);
    });

    it('never limits /health, /health/ready and the Stripe webhook route', async () => {
      for (let i = 0; i < LIMIT * 3; i++) {
        await http().get(api('/health')).expect(200);
        await http().get(api('/health/ready')).expect(200);
        const hook = await http()
          .post(api('/billing/webhook'))
          .set('Stripe-Signature', 't=1,v1=x')
          .send({})
          .expect(409);
        expect((hook.body as ApiErrorResponse).meta?.statusCode).toBe(409);
      }
    });

    it('does not limit the SSE stream endpoint', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await http().get(api('/session')).set(alice.bearer).expect(200);
      }
      // The bucket is full, but /events (rejected here for lacking a token) is not throttled.
      await http().get(api('/events')).expect(401);
    });

    it('limits public routes per address', async () => {
      resetLimits();
      for (let i = 0; i < LIMIT; i++) {
        await http().get(api('/invites/preview?token=x')).expect(404);
      }
      await http().get(api('/invites/preview?token=x')).expect(429);
    });
  });

  describe('gateway throttling', () => {
    it('keys the limit by computer id', async () => {
      const owner = await registerAndLogin(app);
      await dataSource.query("UPDATE workspaces SET plan = 'pro' WHERE id = $1", [
        owner.workspaceId,
      ]);
      const pairComputer = async (name: string): Promise<{ Authorization: string }> => {
        const code = (
          (await http().post(api('/computers/pairing-codes')).set(owner.bearer).expect(200))
            .body as ApiResponse<{ code: string }>
        ).data.code;
        const paired = await http()
          .post(api('/gateway/pair'))
          .send({ code, name, os: 'macOS', cliVersion: '0.1.0' })
          .expect(200);
        return {
          Authorization: `Bearer ${(paired.body as ApiResponse<{ apiKey: string }>).data.apiKey}`,
        };
      };
      const first = await pairComputer('mac-1');
      const second = await pairComputer('mac-2');
      resetLimits();

      const beat = (key: { Authorization: string }) =>
        http().post(api('/gateway/heartbeat')).set(key).send({});
      for (let i = 0; i < LIMIT; i++) await beat(first).expect(200);
      const limited = await beat(first).expect(429);
      expect((limited.body as ApiErrorResponse).meta?.statusCode).toBe(429);
      await beat(second).expect(200);
    });
  });
});

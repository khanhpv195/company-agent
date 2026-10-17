import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthResult } from '@repo/shared';
import { LOW_THROTTLE_LIMIT as LIMIT } from './utils/low-throttle-env';
import { createTestApp, truncateAll } from './utils';

describe('Auth throttling (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    await truncateAll(created.dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 with the standard error envelope and leaves /session alone', async () => {
    const http = () => request(app.getHttpServer());
    const registered = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery' })
      .expect(201);
    const { accessToken } = (registered.body as { data: AuthResult }).data;

    const login = () =>
      http().post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'wrong-pass' });
    // Buckets are per route, so register does not count against login.
    for (let i = 0; i < LIMIT; i++) await login().expect(401);

    const limited = await login().expect(429);
    expect(limited.body).toMatchObject({
      success: false,
      data: null,
      message: 'Too many requests, please slow down',
      meta: { statusCode: 429, path: '/api/v1/auth/login' },
    });

    for (let i = 0; i < LIMIT + 2; i++) {
      await http()
        .get('/api/v1/session')
        .set({ Authorization: `Bearer ${accessToken}` })
        .expect(200);
    }
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { LOW_THROTTLE_LIMIT as LIMIT } from './utils/low-throttle-env';
import { createTestApp, truncateAll } from './utils';

describe('Gateway pairing throttling (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    await truncateAll(created.dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('limits guesses at /gateway/pair with the standard 429 envelope', async () => {
    const pair = () =>
      request(app.getHttpServer())
        .post('/api/v1/gateway/pair')
        .send({ code: 'ZZZZ-ZZZZ', name: 'a', os: 'b', cliVersion: 'c' });
    for (let i = 0; i < LIMIT; i++) await pair().expect(401);
    const limited = await pair().expect(429);
    expect(limited.body).toMatchObject({
      success: false,
      meta: { statusCode: 429, path: '/api/v1/gateway/pair' },
    });
  });
});

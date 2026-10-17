import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { LOW_THROTTLE_LIMIT as LIMIT } from './utils/low-throttle-env';
import { createTestApp, truncateAll } from './utils';

describe('trust proxy off (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    await truncateAll(created.dataSource);
  });
  afterAll(async () => {
    await app.close();
  });

  it('ignores X-Forwarded-For: spoofed addresses share one bucket', async () => {
    const login = (ip: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'nobody@example.com', password: 'wrong-pass' });
    for (let i = 0; i < LIMIT; i++) await login(`203.0.113.${i + 1}`).expect(401);
    await login('203.0.113.99').expect(429);
  });
});

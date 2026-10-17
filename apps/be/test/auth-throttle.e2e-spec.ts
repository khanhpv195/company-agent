import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthResult } from '@repo/shared';
import { LOW_THROTTLE_LIMIT as LIMIT } from './utils/low-throttle-env';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { createTestApp, mintAccessToken, truncateAll } from './utils';

describe('Auth throttling (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    dataSource = created.dataSource;
    await truncateAll(created.dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 with the standard error envelope and leaves /session alone', async () => {
    const http = () => request(app.getHttpServer());
    const registered = await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct-horse-battery1',
        acceptTerms: true,
      })
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

  it('throttles /me/password and DELETE /me per member', async () => {
    const http = () => request(app.getHttpServer());
    const registered = await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Bea',
        email: 'bea@example.com',
        password: 'correct-horse-battery1',
        acceptTerms: true,
      })
      .expect(201);
    const bearer = {
      Authorization: `Bearer ${(registered.body as { data: AuthResult }).data.accessToken}`,
    };
    const change = () =>
      http()
        .post('/api/v1/me/password')
        .set(bearer)
        .send({ currentPassword: 'wrong-pass1', newPassword: 'another-good-pass2' });
    // LIMIT stays below the lockout threshold (5), so the 429 here is the throttle.
    for (let i = 0; i < LIMIT; i++) await change().expect(400);
    const limited = await change().expect(429);
    expect(limited.body).toMatchObject({
      message: 'Too many requests, please slow down',
      meta: { statusCode: 429, path: '/api/v1/me/password' },
    });

    // Another route has its own bucket.
    const remove = () => http().delete('/api/v1/me').set(bearer).send({ password: 'wrong-pass1' });
    await remove().expect(400);

    // Another member is unaffected.
    const other = await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Cy',
        email: 'cy@example.com',
        password: 'correct-horse-battery1',
        acceptTerms: true,
      })
      .expect(201);
    await http()
      .post('/api/v1/me/password')
      .set({ Authorization: `Bearer ${(other.body as { data: AuthResult }).data.accessToken}` })
      .send({ currentPassword: 'wrong-pass1', newPassword: 'another-good-pass2' })
      .expect(400);
  });
  it('throttles the public invite routes and the password-gated workspace routes', async () => {
    const http = () => request(app.getHttpServer());
    // Registering is throttled too, so the owner is created straight in the database.
    const [workspace] = await dataSource.query<{ id: string }[]>(
      "INSERT INTO workspaces (name, slug) VALUES ('Dee workspace', 'dee-workspace') RETURNING id",
    );
    const [member] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO members (workspace_id, name, email, password_hash, role)
       VALUES ($1, 'Dee', 'dee@example.com', $2, 'owner') RETURNING id`,
      [
        workspace.id,
        await argon2.hash('correct-horse-battery1', { memoryCost: 4096, timeCost: 2 }),
      ],
    );
    const bearer = {
      Authorization: `Bearer ${await mintAccessToken(dataSource, {
        memberId: member.id,
        workspaceId: workspace.id,
        role: 'owner',
      })}`,
    };

    const preview = () => http().get('/api/v1/invites/preview').query({ token: 'nope' });
    for (let i = 0; i < LIMIT; i++) await preview().expect(404);
    await preview().expect(429);

    const accept = () =>
      http().post('/api/v1/invites/accept').send({
        token: 'nope',
        name: 'X',
        password: 'correct-horse-battery1',
        acceptTerms: true,
      });
    for (let i = 0; i < LIMIT; i++) await accept().expect(404);
    await accept().expect(429);

    const remove = () =>
      http()
        .delete('/api/v1/workspace')
        .set(bearer)
        .send({ password: 'wrong-pass1', confirmName: 'Dee workspace' });
    for (let i = 0; i < LIMIT; i++) await remove().expect(400);
    await remove().expect(429);
  });
});

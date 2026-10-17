import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthResult } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAll } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  const http = () => request(app.getHttpServer());
  const PASSWORD = 'correct-horse-battery';

  const register = async (
    overrides: Record<string, unknown> = {},
  ): Promise<{ status: number; result: AuthResult }> => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD, ...overrides });
    return { status: response.status, result: (response.body as { data: AuthResult }).data };
  };

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('register', () => {
    it('creates the owner, workspace and tokens', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Ada', email: '  Ada@Example.com ', password: PASSWORD })
        .expect(201);

      const body = response.body as { success: boolean; data: AuthResult; message: string };
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.refreshToken).toEqual(expect.any(String));
      expect(body.data.session).toMatchObject({
        user: { name: 'Ada', email: 'ada@example.com', role: 'owner', color: null },
        workspace: { name: 'Ada workspace', slug: 'ada-workspace', plan: 'free' },
        onboarded: false,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    });

    it('suffixes the slug on collision', async () => {
      await register({ email: 'a@example.com', workspaceName: 'Acme' });
      const second = await register({ email: 'b@example.com', workspaceName: 'Acme' });
      expect(second.result.session.workspace.slug).toBe('acme-2');
    });

    it('rejects a duplicate email case-insensitively with 409', async () => {
      await register();
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Ada 2', email: 'ADA@example.com', password: PASSWORD })
        .expect(409);
      expect(response.body).toMatchObject({
        success: false,
        data: null,
        message: 'An account with this email already exists',
        meta: { statusCode: 409 },
      });
    });

    it('allows only one of two parallel registrations with the same email', async () => {
      const statuses = (await Promise.all([register({ name: 'A' }), register({ name: 'B' })])).map(
        (r) => r.status,
      );
      expect(statuses.sort()).toEqual([201, 409]);
    });

    it('returns a 400 envelope with field errors', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ name: '', email: 'nope', password: 'short' })
        .expect(400);
      const body = response.body as {
        success: boolean;
        message: string;
        meta: { errors: { field: string }[] };
      };
      expect(body.success).toBe(false);
      expect(body.message).toBe('Validation failed');
      expect(body.meta.errors.map((e) => e.field).sort()).toEqual(['email', 'name', 'password']);
    });
  });

  describe('login', () => {
    it('logs in with valid credentials (email normalised)', async () => {
      await register();
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ADA@example.com ', password: PASSWORD })
        .expect(200);
      const data = (response.body as { data: AuthResult }).data;
      expect(data.session.user.email).toBe('ada@example.com');
      expect(data.accessToken).toEqual(expect.any(String));
    });

    it('answers wrong password and unknown email identically', async () => {
      await register();
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'wrong-password' })
        .expect(401);
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'wrong-password' })
        .expect(401);
      const strip = (body: { message: string; meta: { statusCode: number } }) => ({
        message: body.message,
        status: body.meta.statusCode,
      });
      expect(strip(wrong.body as never)).toEqual(strip(unknown.body as never));
      expect((wrong.body as { message: string }).message).toBe('Incorrect email or password');
    });
  });

  describe('session and guard', () => {
    it('GET /session returns the session with a bearer token', async () => {
      const { result } = await register();
      const response = await http()
        .get('/api/v1/session')
        .set(bearer(result.accessToken))
        .expect(200);
      expect((response.body as { data: unknown }).data).toEqual(result.session);
    });

    it('rejects missing, garbage and foreign-secret tokens with 401', async () => {
      const { result } = await register();
      await http().get('/api/v1/session').expect(401);
      await http().get('/api/v1/session').set(bearer('garbage')).expect(401);

      const foreign = await new JwtService().signAsync(
        { sub: result.session.user.id, wid: result.session.workspace.id, role: 'owner' },
        { secret: 'a-different-secret-0123456789abcdefghijkl', expiresIn: 60 },
      );
      const response = await http().get('/api/v1/session').set(bearer(foreign)).expect(401);
      expect(response.body).toMatchObject({ success: false, message: 'Authentication required' });
    });

    it('returns 401 when the member no longer exists', async () => {
      const { result } = await register();
      await dataSource.query('DELETE FROM members');
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(401);
    });

    it('keeps /health public', async () => {
      await http().get('/api/v1/health').expect(200);
    });
  });

  describe('refresh', () => {
    const refresh = (refreshToken: string) =>
      http().post('/api/v1/auth/refresh').send({ refreshToken });

    it('rotates tokens; reusing the old one revokes the whole family', async () => {
      const { result } = await register();

      const rotated = await refresh(result.refreshToken).expect(200);
      const next = (rotated.body as { data: AuthResult }).data;
      expect(next.refreshToken).not.toBe(result.refreshToken);
      expect(next.accessToken).toEqual(expect.any(String));
      expect(next.session).toEqual(result.session);

      const replay = await refresh(result.refreshToken).expect(401);
      expect((replay.body as { message: string }).message).toBe(
        'Your session has expired, please log in again',
      );
      // Reuse detected, so the legitimately rotated token died with the family.
      await refresh(next.refreshToken).expect(401);
    });

    it('rejects unknown tokens and expired tokens', async () => {
      await refresh('unknown-token').expect(401);

      const { result } = await register();
      await dataSource.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'");
      await refresh(result.refreshToken).expect(401);
    });

    it('keeps separate logins in separate families', async () => {
      const { result: first } = await register();
      const second = (
        (
          await http()
            .post('/api/v1/auth/login')
            .send({ email: 'ada@example.com', password: PASSWORD })
            .expect(200)
        ).body as { data: AuthResult }
      ).data;

      await refresh(first.refreshToken).expect(200);
      await refresh(first.refreshToken).expect(401);
      await refresh(second.refreshToken).expect(200);
    });

    it('lets exactly one of two parallel refreshes with the same token succeed', async () => {
      const { result } = await register();
      const responses = await Promise.all([
        refresh(result.refreshToken),
        refresh(result.refreshToken),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);

      // The loser counts as reuse, which revokes the family including the winner's new token.
      const winner = responses.find((r) => r.status === 200);
      const next = (winner?.body as { data: AuthResult }).data;
      await refresh(next.refreshToken).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the family and always returns 200', async () => {
      const { result } = await register();
      const response = await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: result.refreshToken })
        .expect(200);
      expect(response.body).toMatchObject({ success: true, data: null });

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: result.refreshToken })
        .expect(401);

      await http().post('/api/v1/auth/logout').send({ refreshToken: 'unknown' }).expect(200);
      await http().post('/api/v1/auth/logout').send({}).expect(200);
    });
  });

  describe('members', () => {
    it('lists only the caller workspace without password hashes', async () => {
      const { result: ada } = await register();
      const { result: bob } = await register({ name: 'Bob', email: 'bob@example.com' });

      // A second member inside Ada's workspace.
      await dataSource.query(
        `INSERT INTO members (workspace_id, name, email, password_hash, role)
         VALUES ($1, 'Cy', 'cy@example.com', 'x', 'member')`,
        [ada.session.workspace.id],
      );

      const response = await http().get('/api/v1/members').set(bearer(ada.accessToken)).expect(200);
      const data = (response.body as { data: { email: string }[] }).data;
      expect(data.map((m) => m.email)).toEqual(['ada@example.com', 'cy@example.com']);
      expect(JSON.stringify(response.body)).not.toMatch(/password/i);

      const other = await http().get('/api/v1/members').set(bearer(bob.accessToken)).expect(200);
      expect((other.body as { data: unknown[] }).data).toHaveLength(1);

      await http().get('/api/v1/members').expect(401);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { AuthResult, AuthSessionInfo, Session } from '@repo/shared';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { createTestApp, TestClock, truncateAll } from './utils';

const PASSWORD = 'correct-horse-battery1';
const NEW_PASSWORD = 'another-good-pass2';

interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
  meta?: { errors?: { field: string }[] };
}

describe('Account (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mail: MailService;
  let port: number;
  const clock = new TestClock();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
    await app.listen(0);
    port = ((app.getHttpServer() as unknown as http.Server).address() as AddressInfo).port;
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    mail.clearOutbox();
  });

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(response: { body: unknown }): T => (response.body as Envelope<T>).data;

  const register = async (email = 'ada@example.com', name = 'Ada'): Promise<AuthResult> =>
    data<AuthResult>(
      await api()
        .post('/api/v1/auth/register')
        .set('User-Agent', 'Test/1.0')
        .send({ name, email, password: PASSWORD, acceptTerms: true })
        .expect(201),
    );

  const login = async (email = 'ada@example.com', password = PASSWORD): Promise<AuthResult> =>
    data<AuthResult>(
      await api()
        .post('/api/v1/auth/login')
        .set('User-Agent', 'Second/2.0')
        .send({ email, password })
        .expect(200),
    );

  /** A second member of the workspace, signed in through the real login. */
  const addMember = async (
    owner: AuthResult,
    role: 'admin' | 'member',
    email = 'bob@example.com',
  ): Promise<AuthResult> => {
    await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Bob', email, password: PASSWORD, acceptTerms: true })
      .expect(201);
    // Move Bob into the owner's workspace (the invite flow arrives with the team feature).
    await dataSource.query(
      "UPDATE members SET workspace_id = $1, role = $2 WHERE email = 'bob@example.com'",
      [owner.session.workspace.id, role],
    );
    return login(email);
  };

  const sessionsOf = async (auth: AuthResult): Promise<AuthSessionInfo[]> =>
    data<AuthSessionInfo[]>(
      await api().get('/api/v1/me/sessions').set(bearer(auth.accessToken)).expect(200),
    );

  describe('PATCH /me', () => {
    it('updates name and color and returns the session', async () => {
      const ada = await register();
      const response = await api()
        .patch('/api/v1/me')
        .set(bearer(ada.accessToken))
        .send({ name: '  Ada L.  ', color: '#B0516F' })
        .expect(200);
      expect(data<Session>(response).user).toMatchObject({
        name: 'Ada L.',
        color: '#b0516f',
        emailVerified: false,
      });

      const members = await api().get('/api/v1/members').set(bearer(ada.accessToken)).expect(200);
      expect(data<{ name: string }[]>(members)[0].name).toBe('Ada L.');

      const cleared = await api()
        .patch('/api/v1/me')
        .set(bearer(ada.accessToken))
        .send({ color: null })
        .expect(200);
      expect(data<Session>(cleared).user).toMatchObject({ name: 'Ada L.', color: null });
    });

    it.each([
      ['blank name', { name: '   ' }, 'name'],
      ['long name', { name: 'x'.repeat(61) }, 'name'],
      ['named color', { color: 'red' }, 'color'],
      ['short hex', { color: '#fff' }, 'color'],
    ])('rejects a %s', async (_label, body, field) => {
      const ada = await register();
      const response = await api()
        .patch('/api/v1/me')
        .set(bearer(ada.accessToken))
        .send(body)
        .expect(400);
      expect((response.body as Envelope<null>).meta?.errors?.map((e) => e.field)).toEqual([field]);
    });

    it('needs a token', async () => {
      await api().patch('/api/v1/me').send({ name: 'x' }).expect(401);
    });
  });

  describe('POST /me/password', () => {
    it('rejects a wrong current password and a weak or email-equal new one', async () => {
      const ada = await register();
      const change = (body: object) =>
        api().post('/api/v1/me/password').set(bearer(ada.accessToken)).send(body);

      const wrong = await change({
        currentPassword: 'nope-nope-1',
        newPassword: NEW_PASSWORD,
      }).expect(400);
      expect((wrong.body as Envelope<null>).message).toBe('The current password is incorrect');
      await change({ currentPassword: PASSWORD, newPassword: 'letters-only' }).expect(400);
      await change({ currentPassword: PASSWORD, newPassword: 'ada@example.com' }).expect(400);
      // Still the old password.
      await login();
    });

    it('changes the password and revokes every session except the current one', async () => {
      const first = await register();
      const second = await login();
      const response = await api()
        .post('/api/v1/me/password')
        .set(bearer(first.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(response.body).toMatchObject({ success: true, data: null });

      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(401);
      await login('ada@example.com', NEW_PASSWORD);

      const [{ at }] = await dataSource.query<{ at: Date | null }[]>(
        'SELECT password_changed_at AS at FROM members',
      );
      expect(at).toBeInstanceOf(Date);
    });
  });

  describe('sessions', () => {
    it('lists one entry per live login with client info and the current flag', async () => {
      const first = await register();
      const second = await login();

      const list = await sessionsOf(first);
      expect(list).toHaveLength(2);
      const current = list.find((s) => s.current);
      const other = list.find((s) => !s.current);
      expect(current).toMatchObject({ userAgent: 'Test/1.0' });
      expect(other).toMatchObject({ userAgent: 'Second/2.0' });
      expect(current?.ip).toEqual(expect.any(String));
      expect(new Date(current?.lastUsedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(current?.createdAt ?? 0).getTime(),
      );

      const fromSecond = await sessionsOf(second);
      expect(fromSecond.find((s) => s.current)?.userAgent).toBe('Second/2.0');
    });

    it('keeps one entry per family across refreshes and updates the client', async () => {
      const first = await register();
      const refreshed = data<AuthResult>(
        await api()
          .post('/api/v1/auth/refresh')
          .set('User-Agent', 'Refresher/3.0')
          .send({ refreshToken: first.refreshToken })
          .expect(200),
      );
      const list = await sessionsOf(refreshed);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ current: true, userAgent: 'Refresher/3.0' });
      // The old access token carries the same sid, so it is the same session.
      expect((await sessionsOf(first))[0].id).toBe(list[0].id);
    });

    it('revokes one session, 404 for unknown, foreign or malformed ids', async () => {
      const first = await register();
      const second = await login();
      const other = (await sessionsOf(first)).find((s) => !s.current);
      if (!other) throw new Error('missing second session');

      const stranger = await register('eve@example.com', 'Eve');
      await api()
        .delete(`/api/v1/me/sessions/${other.id}`)
        .set(bearer(stranger.accessToken))
        .expect(404);
      await api()
        .delete('/api/v1/me/sessions/00000000-0000-4000-8000-000000000000')
        .set(bearer(first.accessToken))
        .expect(404);
      await api()
        .delete('/api/v1/me/sessions/not-a-uuid')
        .set(bearer(first.accessToken))
        .expect(404);

      const done = await api()
        .delete(`/api/v1/me/sessions/${other.id}`)
        .set(bearer(first.accessToken))
        .expect(200);
      expect(done.body).toMatchObject({ success: true, data: null });
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
      await api()
        .delete(`/api/v1/me/sessions/${other.id}`)
        .set(bearer(first.accessToken))
        .expect(404);
      expect(await sessionsOf(first)).toHaveLength(1);
    });

    it('revoke-others keeps only the current session', async () => {
      const first = await register();
      const second = await login();
      await login();
      await api()
        .post('/api/v1/me/sessions/revoke-others')
        .set(bearer(first.accessToken))
        .expect(200);
      const list = await sessionsOf(first);
      expect(list).toHaveLength(1);
      expect(list[0].current).toBe(true);
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
    });

    it('lets a session revoke itself (the same as logging out)', async () => {
      const first = await register();
      const [mine] = await sessionsOf(first);
      await api()
        .delete(`/api/v1/me/sessions/${mine.id}`)
        .set(bearer(first.accessToken))
        .expect(200);
      await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
    });
  });

  describe('access tokens follow their session', () => {
    const sessionStatus = async (auth: AuthResult) =>
      (await api().get('/api/v1/session').set(bearer(auth.accessToken))).status;

    it('a revoked session loses its access token at once; the revoker keeps theirs', async () => {
      const first = await register();
      const second = await login();
      expect(await sessionStatus(second)).toBe(200);
      const other = (await sessionsOf(first)).find((s) => !s.current);
      await api()
        .delete(`/api/v1/me/sessions/${other?.id}`)
        .set(bearer(first.accessToken))
        .expect(200);
      expect(await sessionStatus(second)).toBe(401);
      expect(await sessionStatus(first)).toBe(200);
    });

    it('revoke-others ends the others but the current session survives', async () => {
      const first = await register();
      const second = await login();
      const third = await login();
      await api()
        .post('/api/v1/me/sessions/revoke-others')
        .set(bearer(first.accessToken))
        .expect(200);
      expect(await sessionStatus(second)).toBe(401);
      expect(await sessionStatus(third)).toBe(401);
      expect(await sessionStatus(first)).toBe(200);
    });

    it('a password change ends the other sessions but not the current one', async () => {
      const first = await register();
      const second = await login();
      await api()
        .post('/api/v1/me/password')
        .set(bearer(first.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(await sessionStatus(second)).toBe(401);
      expect(await sessionStatus(first)).toBe(200);
    });

    it('a password reset ends every session', async () => {
      const first = await register();
      const second = await login();
      await api()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ada@example.com' })
        .expect(200);
      await app.get(AuthService).settled();
      const token = /token=([\w-]+)/.exec(mail.outbox().at(-1)?.text ?? '')?.[1];
      await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(await sessionStatus(first)).toBe(401);
      expect(await sessionStatus(second)).toBe(401);
    });

    it('removing the member ends their token', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'member');
      expect(await sessionStatus(bob)).toBe(200);
      await api()
        .delete('/api/v1/me')
        .set(bearer(bob.accessToken))
        .send({ password: PASSWORD })
        .expect(200);
      expect(await sessionStatus(bob)).toBe(401);
    });

    it('revoking a session and its audit entry commit together', async () => {
      const first = await register();
      const second = await login();
      const other = (await sessionsOf(first)).find((s) => !s.current);
      const audit = jest
        .spyOn(app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      try {
        await api()
          .delete(`/api/v1/me/sessions/${other?.id}`)
          .set(bearer(first.accessToken))
          .expect(500);
      } finally {
        audit.mockRestore();
      }
      // Rolled back: the session is still alive.
      expect(await sessionStatus(second)).toBe(200);
      const rows = await dataSource.query<{ n: string }[]>(
        "SELECT count(*) AS n FROM audit_events WHERE action = 'account.sessions_revoked'",
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  describe('current-password lockout on /me/password and DELETE /me', () => {
    const lockedMessage = 'Too many failed attempts. Wait 15 minutes or reset your password';
    const change = (token: string, currentPassword: string) =>
      api()
        .post('/api/v1/me/password')
        .set(bearer(token))
        .send({ currentPassword, newPassword: NEW_PASSWORD });
    const remove = (token: string, password: string) =>
      api().delete('/api/v1/me').set(bearer(token)).send({ password });
    const counter = async () =>
      (
        await dataSource.query<{ n: number; until: Date | null }[]>(
          "SELECT failed_login_count AS n, locked_until AS until FROM members WHERE email = 'ada@example.com'",
        )
      )[0];

    it('counts wrong passwords, locks after five, and then answers 429 even for the right one', async () => {
      const ada = await register();
      for (let i = 0; i < 4; i++) await change(ada.accessToken, 'nope-nope-1').expect(400);
      expect((await counter()).n).toBe(4);
      await change(ada.accessToken, 'nope-nope-1').expect(400);
      expect((await counter()).until).toBeInstanceOf(Date);

      const locked = await change(ada.accessToken, PASSWORD).expect(429);
      expect((locked.body as Envelope<null>).message).toBe(lockedMessage);
      await remove(ada.accessToken, PASSWORD).expect(429);
      // The login lockout is the same one.
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(429);

      const audit = await dataSource.query<{ action: string }[]>(
        "SELECT action FROM audit_events WHERE action IN ('auth.locked', 'auth.login_failed')",
      );
      expect(audit.filter((e) => e.action === 'auth.locked')).toHaveLength(1);
      expect(audit.filter((e) => e.action === 'auth.login_failed')).toHaveLength(5);

      clock.advance(16 * 60_000);
      await change(ada.accessToken, PASSWORD).expect(200);
    });

    it('shares the counter with DELETE /me and a correct password clears it', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'member');
      for (let i = 0; i < 3; i++) await remove(bob.accessToken, 'nope-nope-1').expect(400);
      await change(bob.accessToken, 'nope-nope-1').expect(400);
      await change(bob.accessToken, PASSWORD).expect(200);
      const [row] = await dataSource.query<{ n: number }[]>(
        "SELECT failed_login_count AS n FROM members WHERE email = 'bob@example.com'",
      );
      expect(row.n).toBe(0);
      for (let i = 0; i < 5; i++) await remove(bob.accessToken, 'nope-nope-1').expect(400);
      await remove(bob.accessToken, NEW_PASSWORD).expect(429);
    });
  });

  describe('event streams', () => {
    const openStream = (token: string): Promise<{ ended: Promise<void>; close: () => void }> =>
      new Promise((resolve, reject) => {
        const req = http.get(
          {
            host: '127.0.0.1',
            port,
            path: '/api/v1/events',
            headers: { Authorization: `Bearer ${token}` },
          },
          (res) => {
            res.resume();
            const ended = new Promise<void>((done) => {
              res.on('end', () => done());
              res.on('close', () => done());
            });
            resolve({ ended, close: () => req.destroy() });
          },
        );
        req.on('error', reject);
      });

    const isOpen = async (stream: { ended: Promise<void> }): Promise<boolean> =>
      (await Promise.race([
        stream.ended.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 300)),
      ])) as boolean;

    it('closes the streams of revoked sessions and keeps the current one', async () => {
      const first = await register();
      const second = await login();
      const mine = await openStream(first.accessToken);
      const theirs = await openStream(second.accessToken);
      try {
        await api()
          .post('/api/v1/me/sessions/revoke-others')
          .set(bearer(first.accessToken))
          .expect(200);
        await theirs.ended;
        expect(await isOpen(mine)).toBe(true);
      } finally {
        mine.close();
        theirs.close();
      }
    });

    it('closes every stream of a member who deletes their account', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'member');
      const stream = await openStream(bob.accessToken);
      try {
        await api()
          .delete('/api/v1/me')
          .set(bearer(bob.accessToken))
          .send({ password: PASSWORD })
          .expect(200);
        await stream.ended;
      } finally {
        stream.close();
      }
    });
  });

  describe('POST /me/verify-email/resend', () => {
    it('is a no-op for a verified member', async () => {
      const ada = await register();
      await dataSource.query('UPDATE members SET email_verified_at = now()');
      mail.clearOutbox();
      await api().post('/api/v1/me/verify-email/resend').set(bearer(ada.accessToken)).expect(200);
      expect(mail.outbox()).toHaveLength(0);
    });

    it('sends a fresh token at most once a minute and retires the old one', async () => {
      const ada = await register();
      const oldToken = /token=([\w-]+)/.exec(mail.outbox()[0].text)?.[1] ?? '';
      const resend = () =>
        api().post('/api/v1/me/verify-email/resend').set(bearer(ada.accessToken));

      // Registration just sent one.
      const tooSoon = await resend().expect(429);
      expect((tooSoon.body as Envelope<null>).message).toContain('wait a minute');

      clock.advance(61_000);
      const sent = await resend().expect(200);
      expect(sent.body).toMatchObject({ success: true, data: null });
      expect(mail.outbox()).toHaveLength(2);
      await resend().expect(429);

      const newToken = /token=([\w-]+)/.exec(mail.outbox()[1].text)?.[1] ?? '';
      expect(newToken).not.toBe(oldToken);
      await api().post('/api/v1/auth/verify-email').send({ token: oldToken }).expect(400);
      await api().post('/api/v1/auth/verify-email').send({ token: newToken }).expect(200);
    });
  });

  describe('DELETE /me', () => {
    const remove = (token: string, password: string) =>
      api().delete('/api/v1/me').set(bearer(token)).send({ password });

    it('refuses a wrong password and the workspace owner', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'member');
      const wrong = await remove(bob.accessToken, 'nope-nope-1').expect(400);
      expect((wrong.body as Envelope<null>).message).toBe('The current password is incorrect');

      const refused = await remove(owner.accessToken, PASSWORD).expect(409);
      expect((refused.body as Envelope<null>).message).toBe(
        'Transfer ownership of the workspace before deleting your account',
      );
      await api().get('/api/v1/session').set(bearer(owner.accessToken)).expect(200);
    });

    it('soft-removes a member: no sign-in, hidden, name scrubbed, email free again', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'admin');
      const response = await remove(bob.accessToken, PASSWORD).expect(200);
      expect(response.body).toMatchObject({ success: true, data: null });

      const [row] = await dataSource.query<
        { name: string; email: string; removed_at: Date | null }[]
      >("SELECT name, email, removed_at FROM members WHERE role = 'admin'");
      expect(row.name).toBe('Deleted user');
      expect(row.email).toMatch(/^removed\+[0-9a-f-]{36}@removed\.invalid$/);
      expect(row.removed_at).toBeInstanceOf(Date);

      await api().get('/api/v1/session').set(bearer(bob.accessToken)).expect(401);
      await api().post('/api/v1/auth/refresh').send({ refreshToken: bob.refreshToken }).expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'bob@example.com', password: PASSWORD })
        .expect(401);
      const members = await api().get('/api/v1/members').set(bearer(owner.accessToken)).expect(200);
      expect(data<{ email: string }[]>(members).map((m) => m.email)).toEqual(['ada@example.com']);

      // The address can sign up again.
      await register('bob@example.com', 'Bob again');
    });

    it('is recorded in the audit log', async () => {
      const owner = await register();
      const bob = await addMember(owner, 'member');
      await remove(bob.accessToken, PASSWORD).expect(200);
      const rows = await dataSource.query<{ action: string }[]>(
        "SELECT action FROM audit_events WHERE action = 'account.deleted'",
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('audit trail of account actions', () => {
    it('records login, profile, password and session events with the actor and ip', async () => {
      const ada = await register();
      await login();
      await api()
        .patch('/api/v1/me')
        .set(bearer(ada.accessToken))
        .send({ name: 'Ada 2' })
        .expect(200);
      await api()
        .post('/api/v1/me/sessions/revoke-others')
        .set(bearer(ada.accessToken))
        .expect(200);
      await api()
        .post('/api/v1/me/password')
        .set(bearer(ada.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      const rows = await dataSource.query<
        { action: string; actor_member_id: string; ip: string | null; meta: object }[]
      >('SELECT action, actor_member_id, ip, meta FROM audit_events ORDER BY created_at, id');
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'auth.login',
          'account.profile_updated',
          'account.sessions_revoked',
          'account.password_changed',
        ]),
      );
      for (const row of rows) {
        expect(row.actor_member_id).toBe(ada.session.user.id);
        expect(row.ip).toEqual(expect.any(String));
      }
      expect(rows.find((r) => r.action === 'account.password_changed')?.meta).toEqual({
        revokedSessions: 0,
      });
    });
  });
});

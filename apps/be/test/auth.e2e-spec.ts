import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthResult } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { AccountTokenService } from '../src/modules/auth/account-token.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import { createTestApp, TestClock, truncateAll } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mail: MailService;
  const clock = new TestClock();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    mail.clearOutbox();
  });

  const http = () => request(app.getHttpServer());
  const PASSWORD = 'correct-horse-battery1';

  const register = async (
    overrides: Record<string, unknown> = {},
  ): Promise<{ status: number; result: AuthResult }> => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        name: 'Ada',
        email: 'ada@example.com',
        password: PASSWORD,
        acceptTerms: true,
        ...overrides,
      });
    return { status: response.status, result: (response.body as { data: AuthResult }).data };
  };

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('register', () => {
    it('creates the owner, workspace and tokens', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Ada', email: '  Ada@Example.com ', password: PASSWORD, acceptTerms: true })
        .expect(201);

      const body = response.body as { success: boolean; data: AuthResult; message: string };
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.refreshToken).toEqual(expect.any(String));
      expect(body.data.session).toMatchObject({
        user: {
          name: 'Ada',
          email: 'ada@example.com',
          role: 'owner',
          color: null,
          emailVerified: false,
        },
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
        .send({ name: 'Ada 2', email: 'ADA@example.com', password: PASSWORD, acceptTerms: true })
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
        .send({ name: '', email: 'nope', password: 'short', acceptTerms: true })
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

  /** The token printed in the last mail to `to` (the same value as in its link). */
  const lastToken = (to: string, route: string): string => {
    const messages = mail
      .outbox()
      .filter((m) => m.to === to && m.text.includes(`#/${route}?token=`));
    const text = messages[messages.length - 1]?.text ?? '';
    const match = /token=([\w-]+)/.exec(text);
    if (!match) throw new Error(`no ${route} mail for ${to}`);
    return match[1];
  };

  const codeInMail = (to: string): string | undefined =>
    /code into the app: (\S+)/.exec(
      mail
        .outbox()
        .filter((m) => m.to === to)
        .at(-1)?.text ?? '',
    )?.[1];

  const errorBody = (response: { body: unknown }) =>
    response.body as {
      success: boolean;
      message: string;
      meta: { statusCode: number; errors?: { field: string }[] };
    };

  describe('terms and password policy', () => {
    it('requires acceptTerms to be true', async () => {
      // Truthy-looking non-booleans are rejected too: only the JSON value true passes.
      for (const acceptTerms of [false, undefined, null, 'yes', 'true', 'on', 1, 0, [true], {}]) {
        const response = await http()
          .post('/api/v1/auth/register')
          .send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD, acceptTerms })
          .expect(400);
        expect(errorBody(response).meta.errors?.map((e) => e.field)).toContain('acceptTerms');
      }
      await expect(dataSource.query('SELECT 1 FROM members')).resolves.toHaveLength(0);
    });

    it('stores terms_accepted_at and mails a verification token', async () => {
      await register();
      const [row] = await dataSource.query<{ t: Date | null; v: Date | null }[]>(
        'SELECT terms_accepted_at AS t, email_verified_at AS v FROM members',
      );
      expect(row.t).toBeInstanceOf(Date);
      expect(row.v).toBeNull();
      const mails = mail.outbox();
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe('ada@example.com');
      expect(mails[0].html).toContain('/#/verify-email?token=');
      // The raw token is also printed as a code to paste into the desktop app.
      expect(codeInMail('ada@example.com')).toBe(lastToken('ada@example.com', 'verify-email'));
    });

    it('writes the mail in the request language', async () => {
      await http()
        .post('/api/v1/auth/register')
        .set('Accept-Language', 'vi')
        .send({
          name: 'Ada',
          email: 'ada@example.com',
          password: PASSWORD,
          acceptTerms: true,
        })
        .expect(201);
      expect(mail.outbox()[0].subject).toBe('Xác minh email của bạn');
    });

    it.each([
      ['too short', 'abc123'],
      ['no digit', 'only-letters-here'],
      ['no letter', '1234567890'],
      ['too long', `a1${'x'.repeat(127)}`],
      ['equal to the email', 'ada1@example.com'],
    ])('rejects a password that is %s', async (_name, password) => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ name: 'Ada', email: 'ada1@example.com', password, acceptTerms: true })
        .expect(400);
      expect(errorBody(response).meta.errors?.map((e) => e.field)).toEqual(['password']);
    });
  });

  describe('forgot and reset password', () => {
    /** Forgot-password mails in the background: wait for it, then hand back the response. */
    const forgot = async (email: string) => {
      const response = await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      await app.get(AuthService).settled();
      return response;
    };
    const reset = (token: string, newPassword = 'brand-new-pass9') =>
      http().post('/api/v1/auth/reset-password').send({ token, newPassword });

    it('answers 200 null for unknown and removed members and mails nobody', async () => {
      await register();
      mail.clearOutbox();
      const unknown = await forgot('ghost@example.com');
      expect(unknown.body).toMatchObject({ success: true, data: null });
      expect(mail.outbox()).toHaveLength(0);

      await dataSource.query(
        "UPDATE members SET removed_at = now(), email = 'removed+x@removed.invalid'",
      );
      await forgot('ada@example.com');
      expect(mail.outbox()).toHaveLength(0);
    });

    it('mails a token for a member, in the request language', async () => {
      await register();
      mail.clearOutbox();
      const response = await http()
        .post('/api/v1/auth/forgot-password')
        .set('Accept-Language', 'vi')
        .send({ email: 'ada@example.com' })
        .expect(200);
      expect(response.body).toMatchObject({ data: null });
      await app.get(AuthService).settled();
      expect(mail.outbox()[0].subject).toBe('Đặt lại mật khẩu');
      expect(mail.outbox()[0].html).toContain('/#/reset-password?token=');
    });

    it('sets the password, signs everything out, and works once', async () => {
      const { result } = await register();
      await forgot('ada@example.com');
      const token = lastToken('ada@example.com', 'reset-password');

      const done = await reset(token).expect(200);
      expect(done.body).toMatchObject({ success: true, data: null });

      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'brand-new-pass9' })
        .expect(200);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: result.refreshToken })
        .expect(401);

      const again = await reset(token).expect(400);
      expect(errorBody(again).message).toBe('This link or code is invalid or has expired');
    });

    it('rejects unknown tokens and a weak password without burning the token', async () => {
      await register({ email: 'ada1@example.com' });
      await reset('not-a-token').expect(400);

      await forgot('ada1@example.com');
      const token = lastToken('ada1@example.com', 'reset-password');
      const weak = await reset(token, 'nodigitshere').expect(400);
      expect(errorBody(weak).meta.errors?.map((e) => e.field)).toEqual(['newPassword']);
      // Fine for the DTO, but equal to the account email: caught in the service.
      const sameAsEmail = await reset(token, 'ada1@example.com').expect(400);
      expect(errorBody(sameAsEmail).message).toContain('not your email');
      await reset(token).expect(200);
    });

    it('expires after one hour', async () => {
      await register();
      await forgot('ada@example.com');
      const token = lastToken('ada@example.com', 'reset-password');
      clock.advance(61 * 60_000);
      await reset(token).expect(400);
    });

    it('a newer token invalidates the older one', async () => {
      await register();
      await forgot('ada@example.com');
      const first = lastToken('ada@example.com', 'reset-password');
      clock.advance(61_000);
      await forgot('ada@example.com');
      const second = lastToken('ada@example.com', 'reset-password');
      expect(second).not.toBe(first);
      await reset(first).expect(400);
      await reset(second).expect(200);
    });

    it('sends one reset mail per address per minute and still answers 200', async () => {
      await register();
      mail.clearOutbox();
      const first = await forgot('ada@example.com');
      const second = await forgot('ada@example.com');
      expect(second.body).toEqual(first.body);
      expect(mail.outbox()).toHaveLength(1);
      const token = lastToken('ada@example.com', 'reset-password');

      // Parallel requests inside the window still produce no extra mail.
      await Promise.all(
        Array.from({ length: 4 }, () =>
          http().post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }),
        ),
      );
      await app.get(AuthService).settled();
      expect(mail.outbox()).toHaveLength(1);

      clock.advance(61_000);
      await forgot('ada@example.com');
      expect(mail.outbox()).toHaveLength(2);
      // The first token was retired by the second.
      await reset(token).expect(400);
    });

    it('answers before the token and mail work is done', async () => {
      await register();
      mail.clearOutbox();
      const tokens = app.get(AccountTokenService);
      const original = tokens.lastIssuedAt.bind(tokens);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const spy = jest
        .spyOn(tokens, 'lastIssuedAt')
        .mockImplementation(async (...args) => (await gate, original(...args)));
      try {
        await http()
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'ada@example.com' })
          .expect(200);
        expect(mail.outbox()).toHaveLength(0);
        release();
        await app.get(AuthService).settled();
        expect(mail.outbox()).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('clears a lockout', async () => {
      await register();
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email: 'ada@example.com', password: 'wrong-pass1' })
          .expect(401);
      }
      await forgot('ada@example.com');
      await reset(lastToken('ada@example.com', 'reset-password')).expect(200);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'brand-new-pass9' })
        .expect(200);
    });
  });

  describe('verify email', () => {
    const verify = (token: string) => http().post('/api/v1/auth/verify-email').send({ token });

    it('verifies once and shows up in the session', async () => {
      const { result } = await register();
      expect(result.session.user.emailVerified).toBe(false);
      const token = lastToken('ada@example.com', 'verify-email');

      const response = await verify(token).expect(200);
      expect(response.body).toMatchObject({ success: true, data: null });
      const session = await http()
        .get('/api/v1/session')
        .set(bearer(result.accessToken))
        .expect(200);
      expect((session.body as { data: AuthResult['session'] }).data.user.emailVerified).toBe(true);

      await verify(token).expect(400);
      await verify('nope').expect(400);
    });

    it('expires after seven days', async () => {
      await register();
      const token = lastToken('ada@example.com', 'verify-email');
      clock.advance(7 * 24 * 3_600_000 + 60_000);
      await verify(token).expect(400);
    });
  });

  describe('login lockout', () => {
    const login = (password: string, email = 'ada@example.com') =>
      http().post('/api/v1/auth/login').send({ email, password });

    it('locks for 15 minutes after five consecutive failures, even for the right password', async () => {
      await register();
      for (let i = 0; i < 5; i++) await login('wrong-pass1').expect(401);

      const locked = await login(PASSWORD).expect(429);
      expect(errorBody(locked).message).toBe(
        'Too many failed attempts. Wait 15 minutes or reset your password',
      );
      await login(PASSWORD).expect(429);

      clock.advance(14 * 60_000);
      await login(PASSWORD).expect(429);
      clock.advance(2 * 60_000);
      await login(PASSWORD).expect(200);
    });

    it('resets the counter on success, so failures must be consecutive', async () => {
      await register();
      for (let i = 0; i < 4; i++) await login('wrong-pass1').expect(401);
      await login(PASSWORD).expect(200);
      for (let i = 0; i < 4; i++) await login('wrong-pass1').expect(401);
      await login(PASSWORD).expect(200);
    });

    it('starts counting afresh after a lock expires', async () => {
      await register();
      for (let i = 0; i < 5; i++) await login('wrong-pass1').expect(401);
      clock.advance(16 * 60_000);
      await login('wrong-pass1').expect(401);
      await login(PASSWORD).expect(200);
    });

    it('counts parallel failures exactly once each and stays locked', async () => {
      await register();
      await Promise.all(Array.from({ length: 5 }, () => login('wrong-pass1')));
      await login(PASSWORD).expect(429);
      const [row] = await dataSource.query<{ n: number; until: Date | null }[]>(
        'SELECT failed_login_count AS n, locked_until AS until FROM members',
      );
      expect(row.n).toBe(0);
      expect(row.until).toBeInstanceOf(Date);
      const count = (action: string) =>
        dataSource
          .query<{ n: string }[]>('SELECT count(*) AS n FROM audit_events WHERE action = $1', [
            action,
          ])
          .then(([r]) => Number(r.n));
      expect(await count('auth.login_failed')).toBe(5);
      expect(await count('auth.locked')).toBe(1);
    });

    it('does not count or extend anything once locked, even with many parallel failures', async () => {
      await register();
      await Promise.all(Array.from({ length: 12 }, () => login('wrong-pass1')));
      const [row] = await dataSource.query<{ n: number; until: Date }[]>(
        'SELECT failed_login_count AS n, locked_until AS until FROM members',
      );
      expect(row.n).toBe(0);
      const locked = row.until.getTime();
      await login('wrong-pass1').expect(429);
      const [after] = await dataSource.query<{ until: Date }[]>(
        'SELECT locked_until AS until FROM members',
      );
      expect(after.until.getTime()).toBe(locked);
      const [audit] = await dataSource.query<{ n: string }[]>(
        "SELECT count(*) AS n FROM audit_events WHERE action = 'auth.locked'",
      );
      expect(Number(audit.n)).toBe(1);
    });

    it('never locks an unknown email', async () => {
      for (let i = 0; i < 7; i++) await login('wrong-pass1', 'ghost@example.com').expect(401);
    });
  });

  describe('names', () => {
    it('strips control characters from the member and workspace name at register', async () => {
      const { status, result } = await register({
        name: '  A\u0000d\na\u001b \u0085',
        workspaceName: 'Lab\r\n\u0007 One',
      });
      expect(status).toBe(201);
      expect(result.session.user.name).toBe('Ada');
      expect(result.session.workspace.name).toBe('Lab One');
      const rows = await dataSource.query<{ name: string }[]>('SELECT name FROM members');
      expect(rows[0].name).toBe('Ada');
    });

    it('rejects a name made only of control characters', async () => {
      const { status } = await register({ name: '\u0000\u0001\n' });
      expect(status).toBe(400);
    });
  });

  describe('removed members', () => {
    it('cannot log in, refresh or use a token', async () => {
      const { result } = await register();
      await dataSource.query(
        "UPDATE members SET removed_at = now(), email = 'removed+ada@removed.invalid'",
      );
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'wrong-pass1' })
        .expect(401);
      const right = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(401);
      expect(errorBody(right).message).toBe(errorBody(wrong).message);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: result.refreshToken })
        .expect(401);
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(401);
    });

    it('hides them from /members', async () => {
      const { result } = await register();
      await dataSource.query(
        `INSERT INTO members (workspace_id, name, email, password_hash, role, removed_at)
         VALUES ($1, 'Gone', 'removed+g@removed.invalid', 'x', 'member', now())`,
        [result.session.workspace.id],
      );
      const response = await http()
        .get('/api/v1/members')
        .set(bearer(result.accessToken))
        .expect(200);
      expect((response.body as { data: unknown[] }).data).toHaveLength(1);
    });
  });

  describe('guard reads the member from the database', () => {
    it('applies a role change at once and rejects a token for another workspace', async () => {
      const { result: ada } = await register();
      const { result: bob } = await register({ name: 'Bob', email: 'bob@example.com' });
      await http().get('/api/v1/audit-events').set(bearer(ada.accessToken)).expect(200);

      await dataSource.query("UPDATE members SET role = 'member' WHERE email = 'ada@example.com'");
      await http().get('/api/v1/audit-events').set(bearer(ada.accessToken)).expect(403);

      const claims = new JwtService().decode<{ sub: string }>(ada.accessToken);
      const forged = await new JwtService().signAsync(
        { sub: claims.sub, wid: bob.session.workspace.id, role: 'owner' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 60 },
      );
      await http().get('/api/v1/session').set(bearer(forged)).expect(401);
    });

    it('rejects a token without a sid, or whose session is revoked, expired or foreign', async () => {
      const { result } = await register();
      const claims = new JwtService().decode<{ sub: string; wid: string; sid: string }>(
        result.accessToken,
      );
      const sign = (extra: Record<string, unknown>, sid: string | undefined = claims.sid) =>
        new JwtService().signAsync(
          { sub: claims.sub, wid: claims.wid, role: 'owner', ...(sid ? { sid } : {}), ...extra },
          { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 60 },
        );
      await http()
        .get('/api/v1/session')
        .set(bearer(await sign({})))
        .expect(200);
      await http()
        .get('/api/v1/session')
        .set(bearer(await sign({}, '')))
        .expect(401);
      await http()
        .get('/api/v1/session')
        .set(bearer(await sign({}, '00000000-0000-4000-8000-000000000000')))
        .expect(401);
      await http()
        .get('/api/v1/session')
        .set(bearer(await sign({ sid: 'nope' })))
        .expect(401);

      // Expired refresh family: the session is over even though the JWT is still valid.
      await dataSource.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'");
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(401);
    });

    it('logout ends the access token at once', async () => {
      const { result } = await register();
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(200);
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: result.refreshToken })
        .expect(200);
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(401);
    });

    it('a refresh keeps the session: the old access token lives, the new one works', async () => {
      const { result } = await register();
      const refreshed = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: result.refreshToken })
        .expect(200);
      const next = (refreshed.body as { data: AuthResult }).data;
      await http().get('/api/v1/session').set(bearer(result.accessToken)).expect(200);
      await http().get('/api/v1/session').set(bearer(next.accessToken)).expect(200);
    });

    it('puts the refresh family id in the access token as sid', async () => {
      const { result } = await register();
      const claims = new JwtService().decode<{ sid?: string }>(result.accessToken);
      const [row] = await dataSource.query<{ family_id: string }[]>(
        'SELECT family_id FROM refresh_tokens',
      );
      expect(claims.sid).toBe(row.family_id);
    });
  });
});

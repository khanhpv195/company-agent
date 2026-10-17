import { INestApplication } from '@nestjs/common';
import { ApiResponse, AuditEvent, CursorPageMeta } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  TestClock,
  truncateAll,
} from './utils';

interface Page {
  items: AuditEvent[];
  nextCursor: string | null;
  limit: number;
  status: number;
}

describe('Audit log (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: LoggedInClient;
  const clock = new TestClock();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app, { name: 'Olive', email: 'olive@example.com' });
    await setPlan(dataSource, owner.workspaceId, 'pro');
  });

  const http = () => request(app.getHttpServer());
  const page = async (client: LoggedInClient, query = '', status = 200): Promise<Page> => {
    const response = await http().get(`/api/v1/audit-events${query}`).set(client.bearer);
    expect(response.status).toBe(status);
    const body = response.body as ApiResponse<AuditEvent[], CursorPageMeta>;
    return {
      items: status === 200 ? body.data : [],
      nextCursor: body.meta?.nextCursor ?? null,
      limit: body.meta?.limit ?? 0,
      status,
    };
  };
  const actions = async (client = owner): Promise<string[]> =>
    (await page(client, '?limit=100')).items.map((e) => e.action);

  describe('access', () => {
    it('is for owners and admins only', async () => {
      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      const member = await addMemberWithRole(dataSource, owner, 'member');
      await http().get('/api/v1/audit-events').expect(401);
      await page(member, '', 403);
      await page(admin);
      await page(owner);
    });

    it('never shows another workspace', async () => {
      const other = await registerAndLogin(app, { email: 'other@example.com' });
      await http().put('/api/v1/scheduler').set(other.bearer).send({ paused: true }).expect(200);
      expect(await actions(other)).toContain('scheduler.updated');
      expect(await actions(owner)).not.toContain('scheduler.updated');
    });
  });

  describe('what gets recorded', () => {
    it('logs login with the actor, ip and workspace', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'olive@example.com', password: 'correct-horse-battery1' })
        .expect(200);
      const { items } = await page(owner);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        action: 'auth.login',
        actor: { id: owner.memberId, name: 'Olive' },
        targetType: null,
        targetId: null,
        meta: {},
      });
      expect(items[0].ip).toEqual(expect.any(String));
      expect(new Date(items[0].at).toString()).not.toBe('Invalid Date');
    });

    it('logs failed logins for existing members only, then the lock', async () => {
      const wrong = (email: string) =>
        http().post('/api/v1/auth/login').send({ email, password: 'wrong-pass1' });
      await wrong('ghost@example.com').expect(401);
      for (let i = 0; i < 5; i++) await wrong('olive@example.com').expect(401);
      const list = await actions();
      expect(list.filter((a) => a === 'auth.login_failed')).toHaveLength(5);
      expect(list.filter((a) => a === 'auth.locked')).toHaveLength(1);
      const locked = (await page(owner, '?limit=100')).items.find(
        (e) => e.action === 'auth.locked',
      );
      expect(locked?.meta).toHaveProperty('lockedUntil');
    });

    it('logs password resets', async () => {
      const mail = app.get(MailService);
      mail.clearOutbox();
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'olive@example.com' })
        .expect(200);
      await app.get(AuthService).settled();
      const token = /token=([\w-]+)/.exec(mail.outbox()[0].text)?.[1];
      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'brand-new-pass9' })
        .expect(200);
      // The reset signed the owner out; the log itself is read with a new login.
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'olive@example.com', password: 'brand-new-pass9' })
        .expect(200);
      const bearer = {
        Authorization: `Bearer ${(login.body as { data: { accessToken: string } }).data.accessToken}`,
      };
      const reread = await http().get('/api/v1/audit-events').set(bearer).expect(200);
      const list = (reread.body as { data: AuditEvent[] }).data.map((e) => e.action);
      expect(list).toContain('auth.password_reset');
    });

    it('logs agent, scheduler, computer and connection changes', async () => {
      const computer = await createComputer(dataSource, owner.workspaceId);

      const created = await http()
        .post('/api/v1/agents')
        .set(owner.bearer)
        .send({ name: 'Scribe', computerId: computer.id })
        .expect(200);
      const agentId = (created.body as { data: { id: string } }).data.id;
      await http()
        .patch(`/api/v1/agents/${agentId}`)
        .set(owner.bearer)
        .send({ name: 'Scribe 2' })
        .expect(200);
      await http().put('/api/v1/scheduler').set(owner.bearer).send({ paused: true }).expect(200);
      await http()
        .post('/api/v1/connections/zalo/connect')
        .set(owner.bearer)
        .send({ account: 'OA', roomName: 'zalo-inbox', agentId, mode: 'draft' })
        .expect(200);
      await http().delete('/api/v1/connections/zalo').set(owner.bearer).expect(200);
      await http().delete(`/api/v1/agents/${agentId}`).set(owner.bearer).expect(200);

      // Pair and revoke a real (non-simulated) computer.
      const code = (
        (await http().post('/api/v1/computers/pairing-codes').set(owner.bearer).expect(200))
          .body as {
          data: { code: string };
        }
      ).data.code;
      const paired = (
        await http()
          .post('/api/v1/gateway/pair')
          .send({ code, name: 'build-box', os: 'Linux', cliVersion: '0.1.0' })
          .expect(200)
      ).body as { data: { computerId: string } };
      await http()
        .delete(`/api/v1/computers/${paired.data.computerId}`)
        .set(owner.bearer)
        .expect(200);

      const { items } = await page(owner, '?limit=100');
      const byAction = (name: string) => items.find((e) => e.action === name);
      expect(items.map((e) => e.action).sort()).toEqual(
        [
          'agent.created',
          'agent.updated',
          'agent.deleted',
          'scheduler.updated',
          'connection.connected',
          'connection.disconnected',
          'computer.paired',
          'computer.revoked',
        ].sort(),
      );
      expect(byAction('agent.created')).toMatchObject({
        actor: { id: owner.memberId, name: 'Olive' },
        targetType: 'agent',
        targetId: agentId,
        meta: { name: 'Scribe' },
      });
      expect(byAction('agent.deleted')?.meta).toEqual({ name: 'Scribe 2' });
      expect(byAction('scheduler.updated')?.meta).toEqual({ paused: true });
      expect(byAction('connection.connected')).toMatchObject({
        targetType: 'connection',
        targetId: 'zalo',
      });
      // A daemon pairs with a code, not as a member.
      expect(byAction('computer.paired')).toMatchObject({
        actor: null,
        targetType: 'computer',
        targetId: paired.data.computerId,
      });
      expect(byAction('computer.revoked')?.actor?.id).toBe(owner.memberId);
    });

    it('rolls the entry back together with a failed change', async () => {
      const computer = await createComputer(dataSource, owner.workspaceId);
      await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Taken' });
      await http()
        .post('/api/v1/agents')
        .set(owner.bearer)
        .send({ name: 'Taken', computerId: computer.id })
        .expect(409);
      expect(await actions()).not.toContain('agent.created');
    });
  });

  describe('listing', () => {
    const seed = async (count: number) => {
      const audit = app.get(AuditService);
      for (let i = 0; i < count; i++) {
        clock.advance(5);
        await audit.record({
          workspaceId: owner.workspaceId,
          actorMemberId: i % 2 ? owner.memberId : null,
          action: `test.event_${String(i).padStart(2, '0')}`,
          targetType: 'thing',
          targetId: String(i),
          meta: { i },
          ip: '10.0.0.1',
        });
      }
    };

    const before = (cursor: string | null) => `&before=${encodeURIComponent(cursor ?? '')}`;

    it('returns newest first and pages backwards with the opaque nextCursor', async () => {
      await seed(7);
      const first = await page(owner, '?limit=3');
      expect(first.items.map((e) => e.action)).toEqual([
        'test.event_06',
        'test.event_05',
        'test.event_04',
      ]);
      expect(first.limit).toBe(3);
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = await page(owner, `?limit=3${before(first.nextCursor)}`);
      expect(second.items.map((e) => e.action)).toEqual([
        'test.event_03',
        'test.event_02',
        'test.event_01',
      ]);

      const third = await page(owner, `?limit=3${before(second.nextCursor)}`);
      expect(third.items.map((e) => e.action)).toEqual(['test.event_00']);
      expect(third.nextCursor).toBeNull();
    });

    it('has no cursor when the last page fits exactly, and none on an empty log', async () => {
      await seed(4);
      const exact = await page(owner, '?limit=4');
      expect(exact.items).toHaveLength(4);
      expect(exact.nextCursor).toBeNull();
      const one = await page(owner, '?limit=3');
      const rest = await page(owner, `?limit=3${before(one.nextCursor)}`);
      expect(rest.items).toHaveLength(1);
      expect(rest.nextCursor).toBeNull();
      await truncateAll(dataSource);
      const other = await registerAndLogin(app, { email: 'fresh@example.com' });
      await dataSource.query('DELETE FROM audit_events');
      const empty = await page(other);
      expect(empty.items).toEqual([]);
      expect(empty.nextCursor).toBeNull();
    });

    it('never skips or repeats events that share a timestamp across a page boundary', async () => {
      await dataSource.query(
        `INSERT INTO audit_events (workspace_id, action, created_at)
         SELECT $1, 'test.same_' || n, '2030-01-01T00:00:00.123456Z' FROM generate_series(1, 5) n`,
        [owner.workspaceId],
      );
      const seen: AuditEvent[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const next: Page = await page(owner, `?limit=2${cursor ? before(cursor) : ''}`);
        seen.push(...next.items);
        cursor = next.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(5);
      expect(new Set(seen.map((e) => e.id)).size).toBe(5);
      expect(new Set(seen.map((e) => e.at)).size).toBe(1);
      // Ties break by id, newest (largest) first.
      const ids = seen.map((e) => e.id);
      expect(ids).toEqual([...ids].sort().reverse());
    });

    it('keeps microsecond precision in the cursor', async () => {
      for (const micros of ['000100', '000200', '000300']) {
        await dataSource.query(
          `INSERT INTO audit_events (workspace_id, action, created_at)
           VALUES ($1, $2, '2030-01-01T00:00:00.${micros}Z')`,
          [owner.workspaceId, `test.micro_${micros}`],
        );
      }
      const actionsOf = async (query: string) =>
        (await page(owner, query)).items.map((e) => e.action);
      const first = await page(owner, '?limit=1');
      expect(first.items[0].action).toBe('test.micro_000300');
      const second = await page(owner, `?limit=1${before(first.nextCursor)}`);
      expect(second.items[0].action).toBe('test.micro_000200');
      expect(await actionsOf(`?limit=1${before(second.nextCursor)}`)).toEqual([
        'test.micro_000100',
      ]);
    });

    it('maps the actor, or null when the event has no member', async () => {
      await seed(2);
      const { items } = await page(owner);
      expect(items[0]).toMatchObject({
        actor: { id: owner.memberId, name: 'Olive' },
        targetType: 'thing',
        targetId: '1',
        meta: { i: 1 },
        ip: '10.0.0.1',
      });
      expect(items[1].actor).toBeNull();
    });

    it('defaults to 50 and validates the query', async () => {
      await seed(52);
      const defaulted = await page(owner);
      expect(defaulted.items).toHaveLength(50);
      expect(defaulted.limit).toBe(50);
      expect(defaulted.nextCursor).toEqual(expect.any(String));
      await page(owner, '?limit=0', 400);
      await page(owner, '?limit=101', 400);
      await page(owner, '?limit=abc', 400);
      await page(owner, '?before=yesterday', 400);
      // The old timestamp form and a well-formed but foreign cursor are not accepted.
      await page(owner, `?before=${encodeURIComponent('2030-01-01T00:00:00.000Z')}`, 400);
      await page(owner, `?before=${Buffer.from('a|b').toString('base64url')}`, 400);
    });
  });
});

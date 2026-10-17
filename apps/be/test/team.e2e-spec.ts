import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditEvent,
  AuthResult,
  CreateInviteResult,
  Invite,
  InvitePreview,
  Member,
  RealtimeEvent,
  Workspace,
} from '@repo/shared';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { MailService } from '../src/modules/mail/mail.service';
import { REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import { INVITE_TTL_MS } from '../src/modules/team/invites.service';
import { createTestApp, setPlan, TestClock, truncateAll } from './utils';

const PASSWORD = 'correct-horse-battery1';
const API = '/api/v1';

interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
  meta?: { errors?: { field: string }[]; nextCursor?: string | null };
}

describe('Team (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mail: MailService;
  let emitter: EventEmitter2;
  let port: number;
  let realtime: RealtimeEnvelope[] = [];
  const clock = new TestClock();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
    await app.listen(0);
    port = ((app.getHttpServer() as unknown as http.Server).address() as AddressInfo).port;
    mail = app.get(MailService);
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    mail.clearOutbox();
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
  });

  const api = () => request(app.getHttpServer());
  const bearer = (a: AuthResult) => ({ Authorization: `Bearer ${a.accessToken}` });
  const data = <T>(response: { body: unknown }): T => (response.body as Envelope<T>).data;
  const messageOf = (response: { body: unknown }): string =>
    (response.body as Envelope<null>).message;
  const eventTypes = (): RealtimeEvent['type'][] => realtime.map((e) => e.event.type);

  /** Registers on `free`, then moves the workspace to `pro` (the seat limit is tested in billing). */
  const register = async (email = 'owner@example.com', workspaceName?: string) => {
    const result = data<AuthResult>(
      await api()
        .post(`${API}/auth/register`)
        .send({
          name: 'Olivia',
          email,
          password: PASSWORD,
          acceptTerms: true,
          ...(workspaceName ? { workspaceName } : {}),
        })
        .expect(201),
    );
    await setPlan(dataSource, result.session.workspace.id, 'pro');
    return result;
  };

  const invite = (as: AuthResult, email: string, role: 'admin' | 'member' = 'member') =>
    api().post(`${API}/invites`).set(bearer(as)).send({ email, role });

  /** Invites `email` and accepts it through the real flow; returns the signed-in member. */
  const join = async (
    owner: AuthResult,
    email: string,
    role: 'admin' | 'member' = 'member',
    name = email.split('@')[0],
  ): Promise<AuthResult> => {
    const created = data<CreateInviteResult>(await invite(owner, email, role).expect(201));
    return data<AuthResult>(
      await api()
        .post(`${API}/invites/accept`)
        .send({ token: created.token, name, password: PASSWORD, acceptTerms: true })
        .expect(201),
    );
  };

  const members = async (as: AuthResult) =>
    data<Member[]>(await api().get(`${API}/members`).set(bearer(as)).expect(200));

  const auditActions = async (as: AuthResult): Promise<AuditEvent[]> =>
    data<AuditEvent[]>(
      await api().get(`${API}/audit-events?limit=100`).set(bearer(as)).expect(200),
    );

  /** owner + admin + member in one workspace. */
  const team = async () => {
    const owner = await register();
    const admin = await join(owner, 'admin@example.com', 'admin');
    const member = await join(owner, 'member@example.com', 'member');
    return { owner, admin, member };
  };

  describe('POST /invites', () => {
    it('creates an invite, returns the token once, and mails it', async () => {
      const owner = await register();
      realtime = [];
      const response = await invite(owner, '  Bob@Example.com ', 'member').expect(201);
      const result = data<CreateInviteResult>(response);
      expect(result.invite).toMatchObject({
        email: 'bob@example.com',
        role: 'member',
        invitedByName: 'Olivia',
      });
      expect(Date.parse(result.invite.expiresAt) - Date.parse(result.invite.createdAt)).toBe(
        INVITE_TTL_MS,
      );
      expect(result.url).toBe(`http://localhost:1420/#/invite?token=${result.token}`);
      expect(JSON.stringify(result.invite)).not.toContain(result.token);

      const [sent] = mail.outbox().filter((m) => m.to === 'bob@example.com');
      expect(sent.text).toContain(result.token);
      expect(sent.text).toContain(result.url);
      expect(eventTypes()).toContain('members.changed');

      const [row] = await dataSource.query<{ token_hash: string }[]>(
        'SELECT token_hash FROM invites',
      );
      expect(row.token_hash).not.toBe(result.token);
    });

    it('lets an admin invite members but only the owner invite admins', async () => {
      const { owner, admin, member } = await team();
      await invite(admin, 'a@example.com', 'member').expect(201);
      const denied = await invite(admin, 'b@example.com', 'admin').expect(403);
      expect(messageOf(denied)).toMatch(/owner/i);
      await invite(owner, 'c@example.com', 'admin').expect(201);
      await invite(member, 'd@example.com', 'member').expect(403);
      await api()
        .post(`${API}/invites`)
        .send({ email: 'e@example.com', role: 'member' })
        .expect(401);
    });

    it('validates email and role (owner cannot be invited)', async () => {
      const owner = await register();
      await invite(owner, 'not-an-email').expect(400);
      await invite(owner, 'x@example.com', 'owner' as never).expect(400);
      await api()
        .post(`${API}/invites`)
        .set(bearer(owner))
        .send({ email: 'x@example.com' })
        .expect(400);
    });

    it('refuses only live members of this workspace, never probing other workspaces', async () => {
      const owner = await register();
      await register('other@example.com');
      // Registered in another workspace: indistinguishable from an unknown address.
      await invite(owner, 'other@example.com').expect(201);
      const own = await invite(owner, 'OWNER@example.com').expect(409);
      expect(messageOf(own)).toMatch(/already a member/i);
    });

    it('replaces a pending invite for the same address', async () => {
      const owner = await register();
      const first = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      const second = data<CreateInviteResult>(
        await invite(owner, 'bob@example.com', 'admin').expect(201),
      );
      expect(second.invite.id).not.toBe(first.invite.id);

      await api().get(`${API}/invites/preview`).query({ token: first.token }).expect(404);
      const preview = data<InvitePreview>(
        await api().get(`${API}/invites/preview`).query({ token: second.token }).expect(200),
      );
      expect(preview.role).toBe('admin');
      const pending = data<Invite[]>(
        await api().get(`${API}/invites`).set(bearer(owner)).expect(200),
      );
      expect(pending.map((i) => i.id)).toEqual([second.invite.id]);
      await api()
        .post(`${API}/invites/accept`)
        .send({ token: first.token, name: 'Bob', password: PASSWORD, acceptTerms: true })
        .expect(404);
    });

    it('allows re-inviting after a revoke and after an expiry', async () => {
      const owner = await register();
      const first = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      await api().delete(`${API}/invites/${first.invite.id}`).set(bearer(owner)).expect(200);
      const second = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      clock.advance(INVITE_TTL_MS + 1000);
      await invite(owner, 'bob@example.com').expect(201);
      expect(second.invite.id).toBeDefined();
    });
  });

  describe('GET /invites and DELETE /invites/:id', () => {
    it('lists pending invites for owner and admin only, hiding expired and revoked ones', async () => {
      const { owner, admin, member } = await team();
      const keep = data<CreateInviteResult>(await invite(owner, 'keep@example.com').expect(201));
      const gone = data<CreateInviteResult>(await invite(owner, 'gone@example.com').expect(201));
      await api().delete(`${API}/invites/${gone.invite.id}`).set(bearer(admin)).expect(200);

      for (const as of [owner, admin]) {
        const list = data<Invite[]>(await api().get(`${API}/invites`).set(bearer(as)).expect(200));
        expect(list.map((i) => i.id)).toEqual([keep.invite.id]);
      }
      await api().get(`${API}/invites`).set(bearer(member)).expect(403);

      clock.advance(INVITE_TTL_MS + 1000);
      expect(
        data<Invite[]>(await api().get(`${API}/invites`).set(bearer(owner)).expect(200)),
      ).toEqual([]);
    });

    it('revokes once, 404s afterwards, and never touches another workspace', async () => {
      const owner = await register();
      const stranger = await register('stranger@example.com');
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      await api().delete(`${API}/invites/${created.invite.id}`).set(bearer(stranger)).expect(404);
      await api().delete(`${API}/invites/${created.invite.id}`).set(bearer(owner)).expect(200);
      await api().delete(`${API}/invites/${created.invite.id}`).set(bearer(owner)).expect(404);
      await api().delete(`${API}/invites/not-a-uuid`).set(bearer(owner)).expect(404);
      await api().get(`${API}/invites/preview`).query({ token: created.token }).expect(404);
      await api().get(`${API}/invites`).set(bearer(stranger)).expect(200);
    });
  });

  describe('GET /invites/preview', () => {
    it('is public and describes the invite', async () => {
      const owner = await register('owner@example.com', 'Acme');
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      const preview = data<InvitePreview>(
        await api().get(`${API}/invites/preview`).query({ token: created.token }).expect(200),
      );
      expect(preview).toEqual({
        workspaceName: 'Acme',
        email: 'bob@example.com',
        role: 'member',
        invitedByName: 'Olivia',
        expiresAt: created.invite.expiresAt,
      });
    });

    it('answers 404 for unknown, expired and missing tokens', async () => {
      const owner = await register();
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      await api().get(`${API}/invites/preview`).query({ token: 'nope' }).expect(404);
      await api().get(`${API}/invites/preview`).expect(400);
      clock.advance(INVITE_TTL_MS + 1000);
      const expired = await api()
        .get(`${API}/invites/preview`)
        .query({ token: created.token })
        .expect(404);
      expect(messageOf(expired)).toMatch(/invalid or has expired/i);
    });
  });

  describe('POST /invites/accept', () => {
    it('creates a verified member with the invited role and signs them in', async () => {
      const owner = await register();
      const created = data<CreateInviteResult>(
        await invite(owner, 'bob@example.com', 'admin').expect(201),
      );
      const accepted = data<AuthResult>(
        await api()
          .post(`${API}/invites/accept`)
          .send({
            token: created.token,
            name: '  Bob\u0000  ',
            password: PASSWORD,
            acceptTerms: true,
          })
          .expect(201),
      );
      expect(accepted.session.user).toMatchObject({
        name: 'Bob',
        email: 'bob@example.com',
        role: 'admin',
        emailVerified: true,
      });
      expect(accepted.session.workspace.id).toBe(owner.session.workspace.id);
      expect(accepted.session.onboarded).toBe(owner.session.onboarded);

      const [row] = await dataSource.query<{ terms_accepted_at: Date | null }[]>(
        "SELECT terms_accepted_at FROM members WHERE email = 'bob@example.com'",
      );
      expect(row.terms_accepted_at).not.toBeNull();
      await api().get(`${API}/members`).set(bearer(accepted)).expect(200);
      await api()
        .post(`${API}/auth/login`)
        .send({ email: 'bob@example.com', password: PASSWORD })
        .expect(200);
      expect((await members(owner)).map((m) => m.email)).toContain('bob@example.com');
      expect(eventTypes()).toContain('members.changed');

      const events = await auditActions(owner);
      expect(events.find((e) => e.action === 'invite.accepted')).toMatchObject({
        actor: { name: 'Bob' },
        targetType: 'invite',
        targetId: created.invite.id,
      });
    });

    it('is single use', async () => {
      const owner = await register();
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      const body = { token: created.token, name: 'Bob', password: PASSWORD, acceptTerms: true };
      await api().post(`${API}/invites/accept`).send(body).expect(201);
      await api().post(`${API}/invites/accept`).send(body).expect(404);
    });

    it('honours the password policy without burning the invite, and requires the terms', async () => {
      const owner = await register();
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      const base = { token: created.token, name: 'Bob', acceptTerms: true };
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...base, password: 'short1' })
        .expect(400);
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...base, password: 'onlyletters' })
        .expect(400);
      // Equal to the invited email: the DTO cannot see it, the service checks it.
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...base, password: 'bob@example.com' })
        .expect(400);
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...base, password: PASSWORD, acceptTerms: false })
        .expect(400);
      await api()
        .post(`${API}/invites/accept`)
        .send({ token: created.token, name: 'Bob', password: PASSWORD })
        .expect(400);
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...base, password: PASSWORD })
        .expect(201);
    });

    it('rejects an expired or revoked invite', async () => {
      const owner = await register();
      const expired = data<CreateInviteResult>(await invite(owner, 'a@example.com').expect(201));
      const revoked = data<CreateInviteResult>(await invite(owner, 'b@example.com').expect(201));
      await api().delete(`${API}/invites/${revoked.invite.id}`).set(bearer(owner)).expect(200);
      const body = { name: 'X', password: PASSWORD, acceptTerms: true };
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...body, token: revoked.token })
        .expect(404);
      clock.advance(INVITE_TTL_MS + 1000);
      await api()
        .post(`${API}/invites/accept`)
        .send({ ...body, token: expired.token })
        .expect(404);
    });

    it('answers 409 when the address got an account in the meantime and keeps the invite', async () => {
      const owner = await register();
      const created = data<CreateInviteResult>(await invite(owner, 'bob@example.com').expect(201));
      await register('bob@example.com');
      const taken = await api()
        .post(`${API}/invites/accept`)
        .send({ token: created.token, name: 'Bob', password: PASSWORD, acceptTerms: true })
        .expect(409);
      expect(messageOf(taken)).toMatch(/already exists/i);
      const [row] = await dataSource.query<{ accepted_at: Date | null }[]>(
        'SELECT accepted_at FROM invites',
      );
      expect(row.accepted_at).toBeNull();
    });
  });

  describe('PATCH /members/:id', () => {
    it('lets only the owner change roles, effective at once', async () => {
      const { owner, admin, member } = await team();
      realtime = [];
      const promoted = data<Member>(
        await api()
          .patch(`${API}/members/${member.session.user.id}`)
          .set(bearer(owner))
          .send({ role: 'admin' })
          .expect(200),
      );
      expect(promoted).toMatchObject({ id: member.session.user.id, role: 'admin' });
      expect(eventTypes()).toContain('members.changed');
      // The old access token (still role "member") already gets admin powers: the guard reads the DB.
      await api().get(`${API}/invites`).set(bearer(member)).expect(200);

      await api()
        .patch(`${API}/members/${member.session.user.id}`)
        .set(bearer(owner))
        .send({ role: 'member' })
        .expect(200);
      await api().get(`${API}/invites`).set(bearer(member)).expect(403);

      await api()
        .patch(`${API}/members/${member.session.user.id}`)
        .set(bearer(admin))
        .send({ role: 'admin' })
        .expect(403);
      await api()
        .patch(`${API}/members/${admin.session.user.id}`)
        .set(bearer(member))
        .send({ role: 'member' })
        .expect(403);

      const actions = (await auditActions(owner)).filter((e) => e.action === 'member.role_changed');
      expect(actions.map((e) => e.meta)).toEqual([
        { from: 'admin', to: 'member' },
        { from: 'member', to: 'admin' },
      ]);
    });

    it('refuses self, the owner, bad roles, unknown ids and other workspaces', async () => {
      const { owner, member } = await team();
      const stranger = await register('stranger@example.com');
      const patch = (as: AuthResult, id: string, role: unknown) =>
        api().patch(`${API}/members/${id}`).set(bearer(as)).send({ role });
      await patch(owner, owner.session.user.id, 'admin').expect(400);
      await patch(owner, member.session.user.id, 'owner').expect(400);
      await patch(owner, member.session.user.id, 'king').expect(400);
      await patch(owner, 'not-a-uuid', 'admin').expect(404);
      await patch(owner, '00000000-0000-4000-8000-000000000000', 'admin').expect(404);
      await patch(stranger, member.session.user.id, 'admin').expect(404);
    });
  });

  describe('DELETE /members/:id', () => {
    it('lets the owner remove anyone else and an admin remove plain members only', async () => {
      const { owner, admin, member } = await team();
      const other = await join(owner, 'other@example.com', 'admin');
      const del = (as: AuthResult, id: string) =>
        api().delete(`${API}/members/${id}`).set(bearer(as));

      await del(admin, owner.session.user.id).expect(403);
      await del(admin, other.session.user.id).expect(403);
      await del(admin, admin.session.user.id).expect(400);
      await del(member, admin.session.user.id).expect(403);
      await del(owner, owner.session.user.id).expect(400);
      await del(owner, 'not-a-uuid').expect(404);

      await del(admin, member.session.user.id).expect(200);
      await del(owner, other.session.user.id).expect(200);
      expect((await members(owner)).map((m) => m.id).sort()).toEqual(
        [owner.session.user.id, admin.session.user.id].sort(),
      );
      await del(owner, member.session.user.id).expect(404);
    });

    it('cuts access at once, frees the email, hides the member and keeps their history', async () => {
      const { owner, admin, member } = await team();
      const memberId = member.session.user.id;
      const created = data<{ id: string }>(
        await api()
          .post(`${API}/tasks`)
          .set(bearer(member))
          .send({ title: 'Bob wrote this', status: 'todo' })
          .expect(200),
      );
      await dataSource.query(
        'INSERT INTO thread_reads (member_id, chat_id, last_read_at) SELECT $1, gen_random_uuid(), now()',
        [memberId],
      );
      realtime = [];

      const stream = await openStream(member.accessToken);
      try {
        await api().delete(`${API}/members/${memberId}`).set(bearer(admin)).expect(200);
        await stream.ended;
      } finally {
        stream.close();
      }

      // 401 on the old access token and on refresh and login.
      await api().get(`${API}/members`).set(bearer(member)).expect(401);
      await api()
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: member.refreshToken })
        .expect(401);
      await api()
        .post(`${API}/auth/login`)
        .send({ email: 'member@example.com', password: PASSWORD })
        .expect(401);
      expect(eventTypes()).toContain('members.changed');

      // Hidden from the people list and from task assignment.
      expect((await members(owner)).map((m) => m.id)).not.toContain(memberId);
      await api()
        .post(`${API}/tasks`)
        .set(bearer(owner))
        .send({ title: 'for a ghost', assigneeId: memberId })
        .expect(400);

      // History intact: the row, its name and the authored task are still there.
      const [row] = await dataSource.query<
        { name: string; removed_at: Date | null; email: string }[]
      >('SELECT name, removed_at, email FROM members WHERE id = $1', [memberId]);
      expect(row.name).toBe('member');
      expect(row.removed_at).not.toBeNull();
      expect(row.email).toBe(`removed+${memberId}@removed.invalid`);
      const tasks = await dataSource.query<{ created_by_member_id: string }[]>(
        'SELECT created_by_member_id FROM tasks WHERE id = $1',
        [created.id],
      );
      expect(tasks[0].created_by_member_id).toBe(memberId);
      const [reads] = await dataSource.query<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM thread_reads WHERE member_id = $1',
        [memberId],
      );
      expect(reads.n).toBe(0);

      // The address can be invited and can register again.
      await invite(owner, 'member@example.com').expect(201);
      await register('member@example.com');

      const removed = (await auditActions(owner)).find((e) => e.action === 'member.removed');
      expect(removed).toMatchObject({
        actor: { id: admin.session.user.id },
        targetId: memberId,
        meta: { name: 'member', role: 'member' },
      });
    });

    it('never reaches into another workspace', async () => {
      const { member } = await team();
      const stranger = await register('stranger@example.com');
      await api()
        .delete(`${API}/members/${member.session.user.id}`)
        .set(bearer(stranger))
        .expect(404);
    });
  });

  describe('POST /workspace/transfer-ownership', () => {
    const transfer = (as: AuthResult, memberId: string, password = PASSWORD) =>
      api()
        .post(`${API}/workspace/transfer-ownership`)
        .set(bearer(as))
        .send({ memberId, password });

    it('swaps owner and admin in one step, effective at once', async () => {
      const { owner, admin, member } = await team();
      realtime = [];
      await transfer(owner, admin.session.user.id).expect(200);
      expect(eventTypes()).toEqual(
        expect.arrayContaining(['members.changed', 'workspace.changed']),
      );

      const roles = Object.fromEntries((await members(owner)).map((m) => [m.id, m.role]));
      expect(roles).toEqual({
        [owner.session.user.id]: 'admin',
        [admin.session.user.id]: 'owner',
        [member.session.user.id]: 'member',
      });
      // The former owner lost owner-only powers immediately.
      await api()
        .patch(`${API}/members/${member.session.user.id}`)
        .set(bearer(owner))
        .send({ role: 'admin' })
        .expect(403);
      await api()
        .patch(`${API}/members/${member.session.user.id}`)
        .set(bearer(admin))
        .send({ role: 'admin' })
        .expect(200);

      const event = (await auditActions(admin)).find(
        (e) => e.action === 'workspace.ownership_transferred',
      );
      expect(event).toMatchObject({
        actor: { id: owner.session.user.id },
        targetId: admin.session.user.id,
      });
    });

    it('works for a plain member target', async () => {
      const { owner, member } = await team();
      await transfer(owner, member.session.user.id).expect(200);
      expect((await members(owner)).find((m) => m.id === member.session.user.id)?.role).toBe(
        'owner',
      );
    });

    it('needs the owner, the right password and a live other member', async () => {
      const { owner, admin, member } = await team();
      await transfer(admin, member.session.user.id).expect(403);
      await transfer(member, admin.session.user.id).expect(403);
      await transfer(owner, admin.session.user.id, 'wrong-password-1').expect(400);
      await transfer(owner, owner.session.user.id).expect(400);
      await transfer(owner, 'not-a-uuid').expect(400);
      await transfer(owner, '00000000-0000-4000-8000-000000000000').expect(404);
      const stranger = await register('stranger@example.com');
      await transfer(stranger, member.session.user.id).expect(404);
      await api().delete(`${API}/members/${member.session.user.id}`).set(bearer(owner)).expect(200);
      await transfer(owner, member.session.user.id).expect(404);
      expect((await members(owner)).find((m) => m.id === owner.session.user.id)?.role).toBe(
        'owner',
      );
    });
  });

  describe('PATCH /workspace', () => {
    it('renames for owner and admin, cleans the name, keeps the slug', async () => {
      const { owner, admin, member } = await team();
      realtime = [];
      const renamed = data<Workspace>(
        await api()
          .patch(`${API}/workspace`)
          .set(bearer(admin))
          .send({ name: '  Acme\u0007 Inc  ' })
          .expect(200),
      );
      expect(renamed).toMatchObject({ id: owner.session.workspace.id, name: 'Acme Inc' });
      expect(renamed.slug).toBe(owner.session.workspace.slug);
      expect(eventTypes()).toContain('workspace.changed');

      const session = data<{ workspace: Workspace }>(
        await api().get(`${API}/session`).set(bearer(owner)).expect(200),
      );
      expect(session.workspace.name).toBe('Acme Inc');
      await api().patch(`${API}/workspace`).set(bearer(member)).send({ name: 'Nope' }).expect(403);
      await api().patch(`${API}/workspace`).set(bearer(owner)).send({ name: '   ' }).expect(400);
      await api()
        .patch(`${API}/workspace`)
        .set(bearer(owner))
        .send({ name: 'x'.repeat(81) })
        .expect(400);
      await api().patch(`${API}/workspace`).set(bearer(owner)).send({}).expect(400);

      const event = (await auditActions(owner)).find((e) => e.action === 'workspace.renamed');
      expect(event?.meta).toEqual({ from: owner.session.workspace.name, to: 'Acme Inc' });
    });
  });

  describe('DELETE /workspace', () => {
    const remove = (as: AuthResult, body: object) =>
      api().delete(`${API}/workspace`).set(bearer(as)).send(body);

    it('needs the owner, the exact name and the password', async () => {
      const owner = await register('owner@example.com', 'Acme');
      const admin = await join(owner, 'admin@example.com', 'admin');
      await remove(admin, { password: PASSWORD, confirmName: 'Acme' }).expect(403);
      await remove(owner, { password: PASSWORD, confirmName: 'acme' }).expect(400);
      await remove(owner, { password: 'wrong-password-1', confirmName: 'Acme' }).expect(400);
      await remove(owner, { password: PASSWORD }).expect(400);
      await api().get(`${API}/members`).set(bearer(owner)).expect(200);
    });

    it('deletes everything in the workspace and nothing in another one', async () => {
      const owner = await register('owner@example.com', 'Acme');
      const bob = await join(owner, 'bob@example.com');
      const other = await register('other@example.com', 'Other');
      await api()
        .post(`${API}/tasks`)
        .set(bearer(bob))
        .send({ title: 'T', status: 'todo' })
        .expect(200);
      await api()
        .post(`${API}/tasks`)
        .set(bearer(other))
        .send({ title: 'Keep', status: 'todo' })
        .expect(200);
      const wid = owner.session.workspace.id;

      const stream = await openStream(bob.accessToken);
      try {
        const response = await remove(owner, { password: PASSWORD, confirmName: '  Acme ' }).expect(
          200,
        );
        expect(data<null>(response)).toBeNull();
        await stream.ended;
      } finally {
        stream.close();
      }

      await api().get(`${API}/members`).set(bearer(owner)).expect(401);
      await api().get(`${API}/members`).set(bearer(bob)).expect(401);
      await api()
        .post(`${API}/auth/login`)
        .send({ email: 'owner@example.com', password: PASSWORD })
        .expect(401);

      // Every table with a workspace_id is empty for it, and so are the member-scoped ones.
      const tables = await dataSource.query<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'workspace_id' AND table_schema = current_schema()`,
      );
      expect(tables.length).toBeGreaterThan(10);
      for (const { table_name } of tables) {
        const [row] = await dataSource.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM "${table_name}" WHERE workspace_id = $1`,
          [wid],
        );
        expect({ table_name, n: row.n }).toEqual({ table_name, n: 0 });
      }
      for (const table of ['refresh_tokens', 'account_tokens', 'thread_reads']) {
        const [row] = await dataSource.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM "${table}" WHERE member_id IN ($1, $2)`,
          [owner.session.user.id, bob.session.user.id],
        );
        expect({ table, n: row.n }).toEqual({ table, n: 0 });
      }

      const survivors = data<{ title: string }[]>(
        await api().get(`${API}/tasks`).set(bearer(other)).expect(200),
      );
      expect(survivors.map((t) => t.title)).toEqual(['Keep']);
      expect((await members(other)).map((m) => m.email)).toEqual(['other@example.com']);
    });
  });

  describe('isolation', () => {
    it('keeps invites, members and audit entries per workspace', async () => {
      const a = await register('a@example.com');
      const b = await register('b@example.com');
      await invite(a, 'x@example.com').expect(201);
      expect(data<Invite[]>(await api().get(`${API}/invites`).set(bearer(b)).expect(200))).toEqual(
        [],
      );
      expect((await members(b)).map((m) => m.email)).toEqual(['b@example.com']);
      expect((await auditActions(b)).some((e) => e.action === 'invite.created')).toBe(false);
      expect((await auditActions(a)).some((e) => e.action === 'invite.created')).toBe(true);
    });
  });

  const openStream = (token: string): Promise<{ ended: Promise<void>; close: () => void }> =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `${API}/events`,
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
});

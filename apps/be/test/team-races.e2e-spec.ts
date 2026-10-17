import { INestApplication, Logger } from '@nestjs/common';
import { AuthResult, CreateInviteResult } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import { TaskTimers } from '../src/modules/tasks/task-timers';
import { createTestApp, createWorld, TestClock, truncateAll } from './utils';

const PASSWORD = 'correct-horse-battery1';
const API = '/api/v1';

/** Timers that only run when a test flushes them. */
class ManualTimers extends TaskTimers {
  pending: (() => void)[] = [];
  override later(_ms: number, fn: () => void): void {
    this.pending.push(fn);
  }
}

describe('Team races (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let engine: TaskEngineService;
  const clock = new TestClock();
  const timers = new ManualTimers();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(TaskTimers)
        .useValue(timers),
    ));
    await app.listen(0);
    engine = app.get(TaskEngineService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await engine.settled();
    await truncateAll(dataSource);
    timers.pending = [];
  });

  const api = () => request(app.getHttpServer());
  const bearer = (a: AuthResult) => ({ Authorization: `Bearer ${a.accessToken}` });
  const data = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

  const register = async (email: string, workspaceName?: string) =>
    data<AuthResult>(
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

  const inviteToken = async (
    owner: AuthResult,
    email: string,
    role: 'admin' | 'member' = 'member',
  ) =>
    data<CreateInviteResult>(
      await api().post(`${API}/invites`).set(bearer(owner)).send({ email, role }).expect(201),
    ).token;

  const accept = (token: string, name = 'Joiner') =>
    api()
      .post(`${API}/invites/accept`)
      .send({ token, name, password: PASSWORD, acceptTerms: true });

  const join = async (owner: AuthResult, email: string, role: 'admin' | 'member' = 'member') =>
    data<AuthResult>(await accept(await inviteToken(owner, email, role), email).expect(201));

  const liveOwners = async (workspaceId: string): Promise<number> => {
    const [row] = await dataSource.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM members
       WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL`,
      [workspaceId],
    );
    return row.n;
  };

  it('keeps exactly one live owner when a transfer races the target deleting their account', async () => {
    for (let round = 0; round < 3; round++) {
      const owner = await register(`owner${round}@example.com`);
      const admin = await join(owner, `admin${round}@example.com`, 'admin');
      const [transfer, removal] = await Promise.all([
        api()
          .post(`${API}/workspace/transfer-ownership`)
          .set(bearer(owner))
          .send({ memberId: admin.session.user.id, password: PASSWORD }),
        api().delete(`${API}/me`).set(bearer(admin)).send({ password: PASSWORD }),
      ]);
      expect([200, 404, 409]).toContain(transfer.status);
      expect([200, 409]).toContain(removal.status);
      expect(await liveOwners(owner.session.workspace.id)).toBe(1);
    }
  });

  it('lets exactly one of two parallel accepts of one token win', async () => {
    const owner = await register('owner@example.com');
    const token = await inviteToken(owner, 'bob@example.com');
    const [a, b] = await Promise.all([accept(token, 'Bob A'), accept(token, 'Bob B')]);
    expect([a.status, b.status].sort()).toEqual([201, 404]);
    const [row] = await dataSource.query<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM members WHERE email = 'bob@example.com'",
    );
    expect(row.n).toBe(1);
  });

  it('answers 404 invites.INVALID when the workspace is deleted before the accept', async () => {
    const owner = await register('owner@example.com', 'Acme');
    const token = await inviteToken(owner, 'bob@example.com');
    await api()
      .delete(`${API}/workspace`)
      .set(bearer(owner))
      .send({ password: PASSWORD, confirmName: 'Acme' })
      .expect(200);
    const response = await accept(token).expect(404);
    expect((response.body as { message: string }).message).toMatch(/invalid or has expired/i);
  });

  it('revokes invites and pairing codes of a removed member and unassigns their open tasks', async () => {
    const owner = await register('owner@example.com');
    const admin = await join(owner, 'admin@example.com', 'admin');
    const adminId = admin.session.user.id;
    const wid = owner.session.workspace.id;

    const pendingToken = await inviteToken(admin, 'guest@example.com');
    await api().post(`${API}/computers/pairing-codes`).set(bearer(admin)).expect(200);
    const makeTask = async (status: string) =>
      data<{ id: string }>(
        await api()
          .post(`${API}/tasks`)
          .set(bearer(owner))
          .send({ title: `T ${status}`, status, assigneeId: adminId })
          .expect(200),
      ).id;
    const open = await makeTask('todo');
    const finished = await makeTask('done');

    await api().delete(`${API}/members/${adminId}`).set(bearer(owner)).expect(200);

    await api().get(`${API}/invites/preview`).query({ token: pendingToken }).expect(404);
    await accept(pendingToken).expect(404);
    const [codes] = await dataSource.query<{ live: number }[]>(
      'SELECT count(*)::int AS live FROM pairing_codes WHERE created_by = $1 AND used_at IS NULL',
      [adminId],
    );
    expect(codes.live).toBe(0);

    const rows = await dataSource.query<
      { id: string; status: string; assignee_member_id: string | null }[]
    >('SELECT id, status, assignee_member_id FROM tasks WHERE id = ANY($1)', [[open, finished]]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(open)).toMatchObject({ status: 'todo', assignee_member_id: null });
    expect(byId.get(finished)).toMatchObject({ status: 'done', assignee_member_id: adminId });
    const [activity] = await dataSource.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM task_activity WHERE task_id = $1 AND by IS NULL',
      [open],
    );
    expect(activity.n).toBeGreaterThan(0);

    const audit = await dataSource.query<{ meta: Record<string, number> }[]>(
      "SELECT meta FROM audit_events WHERE workspace_id = $1 AND action = 'member.removed'",
      [wid],
    );
    expect(audit[0].meta).toMatchObject({
      revokedInvites: 1,
      revokedPairingCodes: 1,
      unassignedTasks: 1,
    });
  });

  it('survives deleting a workspace with a running task and queued work', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const owner = await register('owner@example.com', 'Acme');
      const me = {
        accessToken: owner.accessToken,
        workspaceId: owner.session.workspace.id,
        memberId: owner.session.user.id,
        bearer: bearer(owner),
      };
      const world = await createWorld(dataSource, me, clock.now().getTime());
      const wid = me.workspaceId;
      // A todo -> doing move queues a delayed pick-up timer; keep it for after the delete.
      const todo = data<{ id: string }>(
        await api()
          .post(`${API}/tasks`)
          .set(bearer(owner))
          .send({ title: 'queued', status: 'todo', assigneeId: world.agents.a2.id })
          .expect(200),
      );
      await api()
        .post(`${API}/tasks/${todo.id}/move`)
        .set(bearer(owner))
        .send({ status: 'doing' })
        .expect(200);

      const [deleted, late] = await Promise.all([
        api()
          .delete(`${API}/workspace`)
          .set(bearer(owner))
          .send({ password: PASSWORD, confirmName: 'Acme' }),
        api().post(`${API}/tasks`).set(bearer(owner)).send({ title: 'racing', status: 'todo' }),
      ]);
      expect(deleted.status).toBe(200);
      expect([200, 404]).toContain(late.status);

      // Timers and listeners: a quiet no-op.
      while (timers.pending.length) {
        timers.pending.shift()!();
        await engine.settled();
      }
      await expect(engine.pickAll(wid)).resolves.toBeUndefined();
      await expect(engine.advance(wid, 'AG-31')).resolves.toBeUndefined();
      // A user command is a 404.
      await expect(engine.createTask(wid, me.memberId, { title: 'x' })).rejects.toMatchObject({
        status: 404,
      });
      await engine.settled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(errors).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      errors.mockRestore();
    }
  });
});

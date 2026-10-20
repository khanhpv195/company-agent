import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Agent as AgentContract,
  ApiResponse,
  AuditEvent,
  AuthResult,
  CreateInviteResult,
  Department,
  Invite,
  Member,
  Room,
  Session,
} from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REALTIME_EVENT, type RealtimeEnvelope } from '../src/modules/events';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  truncateAll,
} from './utils';

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

const NIL = '00000000-0000-0000-0000-000000000000';
const PASSWORD = 'correct-horse-battery1';

describe('Departments (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;

  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let alice: LoggedInClient;
  let bob: LoggedInClient;
  let outsider: LoggedInClient;
  let computerId: string;
  let agentId: string;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
    await setPlan(dataSource, owner.workspaceId, 'team');
    admin = await addMemberWithRole(dataSource, owner, 'admin');
    alice = await addMemberWithRole(dataSource, owner, 'member');
    bob = await addMemberWithRole(dataSource, owner, 'member');
    outsider = await registerAndLogin(app);
    computerId = (await createComputer(dataSource, owner.workspaceId)).id;
    agentId = (await createAgent(dataSource, owner.workspaceId, computerId, { name: 'Alpha' })).id;
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (event: RealtimeEnvelope) => realtime.push(event));
  });

  // ---------- helpers ----------
  const raw = (verb: Verb, path: string, client: LoggedInClient, body?: object) =>
    request(app.getHttpServer())[verb](`/api/v1${path}`).set(client.bearer).send(body);
  const call = async <T>(
    verb: Verb,
    path: string,
    client: LoggedInClient,
    body?: object,
    expected = 200,
  ): Promise<T> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const fail = async (
    verb: Verb,
    path: string,
    client: LoggedInClient,
    status: number,
    body?: object,
  ): Promise<string> => {
    const response = await raw(verb, path, client, body);
    expect(response.status).toBe(status);
    return (response.body as ApiResponse<null>).message;
  };
  const create = (name: string, client = owner, extra: object = {}) =>
    call<Department>('post', '/departments', client, { name, ...extra });
  const list = (client = owner) => call<Department[]>('get', '/departments', client);
  const members = async () => call<Member[]>('get', '/members', owner);
  const memberOf = async (id: string) => (await members()).find((m) => m.id === id)!;
  const agentOf = (id: string) => call<AgentContract>('get', `/agents/${id}`, owner);
  const channels = async (client = owner) =>
    (await call<Room[]>('get', '/rooms', client)).filter((room) => room.kind === 'channel');
  const eventTypes = () => realtime.map((e) => e.event.type);
  const audit = async () =>
    (await call<AuditEvent[]>('get', '/audit-events?limit=100', owner)).map((e) => e.action);
  /** Rooms the member / agent belongs to, by channel name. */
  const roomsOfMember = async (memberId: string): Promise<string[]> =>
    (
      (await dataSource.query(
        `SELECT r.name FROM room_members rm JOIN rooms r ON r.id = rm.room_id
         WHERE rm.member_id = $1 ORDER BY r.name`,
        [memberId],
      )) as { name: string }[]
    ).map((row) => row.name);
  const roomsOfAgent = async (id: string): Promise<string[]> =>
    (
      (await dataSource.query(
        `SELECT r.name FROM room_members rm JOIN rooms r ON r.id = rm.room_id
         WHERE rm.agent_id = $1 ORDER BY r.name`,
        [id],
      )) as { name: string }[]
    ).map((row) => row.name);

  // ---------- create / list ----------
  describe('POST /departments and GET /departments', () => {
    it('creates a department with a public channel the creator owns', async () => {
      const department = await create('Kinh doanh', owner, { icon: 'chart' });
      expect(department).toMatchObject({ name: 'Kinh doanh', icon: 'chart', rank: 0 });
      expect(department.roomId).toEqual(expect.any(String));
      const room = (await channels()).find((r) => r.id === department.roomId)!;
      expect(room).toMatchObject({ name: 'kinh-doanh', isPrivate: false });
      const rows = (await dataSource.query(
        `SELECT member_id, role FROM room_members WHERE room_id = $1`,
        [department.roomId],
      )) as { member_id: string; role: string }[];
      expect(rows).toEqual([{ member_id: owner.memberId, role: 'owner' }]);
      expect(eventTypes()).toEqual(
        expect.arrayContaining(['departments.changed', 'rooms.changed']),
      );
    });

    it('defaults the icon, ranks in creation order, and lets any member read the list', async () => {
      const a = await create('Kinh doanh');
      const b = await create('Kỹ thuật', admin);
      expect(a).toMatchObject({ icon: 'users', rank: 0 });
      expect(b.rank).toBe(1);
      expect((await list(alice)).map((d) => d.name)).toEqual(['Kinh doanh', 'Kỹ thuật']);
    });

    it('only owner and admin write', async () => {
      await fail('post', '/departments', alice, 403, { name: 'Marketing' });
      const dept = await create('Marketing');
      await fail('patch', `/departments/${dept.id}`, alice, 403, { name: 'X' });
      await fail('put', '/departments/order', alice, 403, { ids: [dept.id] });
      await fail('delete', `/departments/${dept.id}`, alice, 403);
      await fail('put', `/members/${bob.memberId}/department`, alice, 403, { departmentId: null });
      await fail('put', `/agents/${agentId}/department`, alice, 403, { departmentId: null });
      await fail('put', `/members/${bob.memberId}/title`, alice, 403, { title: 'Boss' });
      await call('get', '/departments', alice);
    });

    it('is case and whitespace insensitive about duplicates', async () => {
      await create('Kinh doanh');
      for (const name of ['kinh doanh', '  KINH   DOANH ', 'Kinh doanh']) {
        expect(await fail('post', '/departments', owner, 409, { name })).toBe(
          'A department with this name already exists',
        );
      }
      expect(await list()).toHaveLength(1);
    });

    it('names the channel from the slug without diacritics and suffixes collisions', async () => {
      expect((await channels()).map((r) => r.name)).toEqual([]);
      const first = await create('Kế toán');
      expect((await channels()).find((r) => r.id === first.roomId)?.name).toBe('ke-toan');
      // A channel somebody made by hand, then a department with the same slug.
      await call('post', '/rooms', owner, { name: 'dao-tao' });
      const trained = await create('Đào tạo');
      expect((await channels()).find((r) => r.id === trained.roomId)?.name).toBe('dao-tao-2');
      // Same slug as "Kế toán" ("Ke toan" is another department name).
      const second = await create('Ke toan');
      const third = await create('KE-TOAN');
      const names = (await channels()).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['ke-toan', 'ke-toan-2', 'ke-toan-3']));
      expect((await channels()).find((r) => r.id === second.roomId)?.name).toBe('ke-toan-2');
      expect((await channels()).find((r) => r.id === third.roomId)?.name).toBe('ke-toan-3');
    });

    it('serializes two parallel creates with the same name: one success, one 409', async () => {
      const results = await Promise.all([
        raw('post', '/departments', owner, { name: 'Kinh doanh' }),
        raw('post', '/departments', owner, { name: 'kinh  doanh' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await list()).toHaveLength(1);
    });

    it('gives parallel creates with colliding slugs distinct channel names', async () => {
      const results = await Promise.all([
        raw('post', '/departments', owner, { name: 'Kế toán' }),
        raw('post', '/departments', owner, { name: 'Ke toan' }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const names = (await channels()).map((r) => r.name).sort();
      expect(names).toEqual(['ke-toan', 'ke-toan-2']);
    });

    it('validates the body', async () => {
      await fail('post', '/departments', owner, 400, { name: '   ' });
      await fail('post', '/departments', owner, 400, {});
      await fail('post', '/departments', owner, 400, { name: 'x'.repeat(61) });
      await fail('post', '/departments', owner, 400, { name: 'Ok', icon: 'rocket' });
      expect(await list()).toEqual([]);
    });

    it('does not publish anything for a rejected command', async () => {
      await create('Kinh doanh');
      realtime = [];
      await fail('post', '/departments', owner, 409, { name: 'kinh doanh' });
      expect(eventTypes()).not.toContain('departments.changed');
    });

    it('keeps workspaces apart', async () => {
      await create('Kinh doanh');
      expect(await list(outsider)).toEqual([]);
      const theirs = await create('Kinh doanh', outsider);
      expect(theirs.roomId).not.toBeNull();
    });
  });

  // ---------- update ----------
  describe('PATCH /departments/:id', () => {
    it('renames and changes the icon, but the room keeps its name', async () => {
      const dept = await create('Kinh doanh');
      const updated = await call<Department>('patch', `/departments/${dept.id}`, admin, {
        name: 'Bán hàng',
        icon: 'phone',
      });
      expect(updated).toMatchObject({ name: 'Bán hàng', icon: 'phone', roomId: dept.roomId });
      expect((await channels()).find((r) => r.id === dept.roomId)?.name).toBe('kinh-doanh');
      // The freed name can be used again.
      await create('Kinh doanh');
    });

    it('rejects a duplicate name but accepts a change of case on itself', async () => {
      const a = await create('Kinh doanh');
      await create('Kỹ thuật');
      await fail('patch', `/departments/${a.id}`, owner, 409, { name: 'kỹ THUẬT' });
      const recased = await call<Department>('patch', `/departments/${a.id}`, owner, {
        name: 'KINH DOANH',
      });
      expect(recased.name).toBe('KINH DOANH');
    });

    it('answers 404 for unknown, malformed and foreign ids', async () => {
      const mine = await create('Kinh doanh');
      await fail('patch', `/departments/${NIL}`, owner, 404, { name: 'X' });
      await fail('patch', '/departments/nope', owner, 404, { name: 'X' });
      await fail('patch', `/departments/${mine.id}`, outsider, 404, { name: 'X' });
      await fail('delete', `/departments/${mine.id}`, outsider, 404);
    });
  });

  // ---------- reorder ----------
  describe('PUT /departments/order', () => {
    it('rewrites the ranks to 0..n-1', async () => {
      const a = await create('A');
      const b = await create('B');
      const c = await create('C');
      const reordered = await call<Department[]>('put', '/departments/order', admin, {
        ids: [c.id, a.id, b.id],
      });
      expect(reordered.map((d) => [d.name, d.rank])).toEqual([
        ['C', 0],
        ['A', 1],
        ['B', 2],
      ]);
      expect((await list(alice)).map((d) => d.name)).toEqual(['C', 'A', 'B']);
      expect(await audit()).toContain('department.reordered');
    });

    it('must list exactly the live departments', async () => {
      const a = await create('A');
      const b = await create('B');
      const foreign = await create('A', outsider);
      await fail('put', '/departments/order', owner, 400, { ids: [a.id] });
      await fail('put', '/departments/order', owner, 400, { ids: [a.id, a.id] });
      await fail('put', '/departments/order', owner, 400, { ids: [a.id, b.id, NIL] });
      await fail('put', '/departments/order', owner, 400, { ids: [a.id, foreign.id] });
      await fail('put', '/departments/order', owner, 400, { ids: [a.id, 'nope'] });
      await fail('put', '/departments/order', owner, 400, {});
      await call('delete', `/departments/${b.id}`, owner);
      await fail('put', '/departments/order', owner, 400, { ids: [a.id, b.id] });
      await call('put', '/departments/order', owner, { ids: [a.id] });
    });
  });

  // ---------- delete ----------
  describe('DELETE /departments/:id', () => {
    it('clears assignments, keeps the room and its members, frees the name', async () => {
      const a = await create('Kinh doanh');
      const b = await create('Kỹ thuật');
      await call('put', `/members/${alice.memberId}/department`, owner, { departmentId: a.id });
      await call('put', `/agents/${agentId}/department`, owner, { departmentId: a.id });
      const invited = await call<CreateInviteResult>(
        'post',
        '/invites',
        owner,
        { email: 'new@example.com', role: 'member', departmentId: a.id, title: 'Sales' },
        201,
      );
      expect(invited.invite).toMatchObject({ departmentId: a.id, title: 'Sales' });
      realtime = [];

      await call('delete', `/departments/${a.id}`, owner);

      expect((await list()).map((d) => d.name)).toEqual(['Kỹ thuật']);
      expect((await list())[0]).toMatchObject({ id: b.id, rank: 0 });
      expect((await memberOf(alice.memberId)).departmentId).toBeNull();
      expect((await agentOf(agentId)).departmentId).toBeNull();
      const pending = await call<Invite[]>('get', '/invites', owner);
      expect(pending[0]).toMatchObject({ departmentId: null, title: 'Sales' });
      expect(await roomsOfMember(alice.memberId)).toContain('kinh-doanh');
      expect(await roomsOfAgent(agentId)).toContain('kinh-doanh');
      expect((await channels()).map((r) => r.id)).toContain(a.roomId);
      expect(eventTypes()).toEqual(
        expect.arrayContaining(['departments.changed', 'members.changed', 'agents.changed']),
      );
      expect(await audit()).toContain('department.deleted');

      await fail('patch', `/departments/${a.id}`, owner, 404, { name: 'Z' });
      await fail('delete', `/departments/${a.id}`, owner, 404);
      await fail('put', `/members/${bob.memberId}/department`, owner, 404, { departmentId: a.id });
      const again = await create('Kinh doanh');
      expect(again.roomId).not.toBe(a.roomId);
      expect((await channels()).map((r) => r.name)).toEqual(
        expect.arrayContaining(['kinh-doanh', 'kinh-doanh-2']),
      );
    });
  });

  // ---------- assignments ----------
  describe('assigning members and agents', () => {
    it('adds a member to the department room and never leaves the old one', async () => {
      const a = await create('Kinh doanh');
      const b = await create('Kỹ thuật');
      const first = await call<Member>('put', `/members/${alice.memberId}/department`, admin, {
        departmentId: a.id,
      });
      expect(first.departmentId).toBe(a.id);
      expect(await roomsOfMember(alice.memberId)).toEqual(['kinh-doanh']);
      realtime = [];
      await call('put', `/members/${alice.memberId}/department`, admin, { departmentId: b.id });
      expect(await roomsOfMember(alice.memberId)).toEqual(['kinh-doanh', 'ky-thuat']);
      expect(eventTypes()).toEqual(
        expect.arrayContaining(['members.changed', 'departments.changed', 'rooms.changed']),
      );
      const cleared = await call<Member>('put', `/members/${alice.memberId}/department`, admin, {
        departmentId: null,
      });
      expect(cleared.departmentId).toBeNull();
      expect(await roomsOfMember(alice.memberId)).toEqual(['kinh-doanh', 'ky-thuat']);
      expect(await audit()).toContain('member.department_changed');
    });

    it('repeating an assignment changes nothing', async () => {
      const a = await create('Kinh doanh');
      await call('put', `/members/${alice.memberId}/department`, owner, { departmentId: a.id });
      realtime = [];
      await call('put', `/members/${alice.memberId}/department`, owner, { departmentId: a.id });
      expect(eventTypes()).toEqual([]);
      const rows = (await dataSource.query(
        `SELECT count(*)::int AS n FROM room_members WHERE room_id = $1 AND member_id = $2`,
        [a.roomId, alice.memberId],
      )) as { n: number }[];
      expect(rows[0].n).toBe(1);
    });

    it('adds an agent to the room too, and keeps the old room', async () => {
      const a = await create('Kinh doanh');
      const b = await create('Kỹ thuật');
      const moved = await call<AgentContract>('put', `/agents/${agentId}/department`, owner, {
        departmentId: a.id,
      });
      expect(moved.departmentId).toBe(a.id);
      expect(await roomsOfAgent(agentId)).toEqual(['kinh-doanh']);
      await call('put', `/agents/${agentId}/department`, owner, { departmentId: b.id });
      expect(await roomsOfAgent(agentId)).toEqual(['kinh-doanh', 'ky-thuat']);
      expect((await agentOf(agentId)).departmentId).toBe(b.id);
      await call('put', `/agents/${agentId}/department`, owner, { departmentId: null });
      expect((await agentOf(agentId)).departmentId).toBeNull();
      expect(await audit()).toContain('agent.department_changed');
    });

    it('creates and updates agents with a department and a title', async () => {
      const a = await create('Kinh doanh');
      const created = await call<AgentContract>('post', '/agents', owner, {
        name: 'Beta',
        computerId,
        departmentId: a.id,
        title: '  Trợ lý bán hàng ',
      });
      expect(created).toMatchObject({ departmentId: a.id, title: 'Trợ lý bán hàng' });
      expect(await roomsOfAgent(created.id)).toEqual(['kinh-doanh']);

      const b = await create('Kỹ thuật');
      const updated = await call<AgentContract>('patch', `/agents/${created.id}`, owner, {
        departmentId: b.id,
        title: 'Kỹ sư',
      });
      expect(updated).toMatchObject({ departmentId: b.id, title: 'Kỹ sư' });
      expect(await roomsOfAgent(created.id)).toEqual(['kinh-doanh', 'ky-thuat']);
      const cleared = await call<AgentContract>('patch', `/agents/${created.id}`, owner, {
        departmentId: null,
        title: '',
      });
      expect(cleared).toMatchObject({ departmentId: null, title: null });

      await fail('post', '/agents', owner, 404, { name: 'Gamma', computerId, departmentId: NIL });
      await fail('post', '/agents', owner, 400, {
        name: 'Gamma',
        computerId,
        title: 'x'.repeat(81),
      });
      expect((await call<AgentContract[]>('get', '/agents', owner)).map((x) => x.name)).toEqual(
        expect.arrayContaining(['Alpha', 'Beta']),
      );
    });

    it('moves an agent to another computer and department in one PATCH (simulated -> real, plan lock)', async () => {
      const sim = await createComputer(dataSource, owner.workspaceId, { simulated: true });
      const real = await createComputer(dataSource, owner.workspaceId, { name: 'real-box' });
      const moving = await createAgent(dataSource, owner.workspaceId, sim.id, { name: 'Mover' });
      const dept = await create('Kinh doanh');
      const updated = await call<AgentContract>('patch', `/agents/${moving.id}`, owner, {
        computerId: real.id,
        departmentId: dept.id,
        title: 'Chuyển',
      });
      expect(updated).toMatchObject({
        computerId: real.id,
        departmentId: dept.id,
        title: 'Chuyển',
      });
      expect(await roomsOfAgent(moving.id)).toEqual(['kinh-doanh']);
      await fail('patch', `/agents/${moving.id}`, owner, 404, {
        computerId: sim.id,
        departmentId: NIL,
      });
      expect((await agentOf(moving.id)).computerId).toBe(real.id);
    });

    it('answers 404 for unknown, malformed, deleted and foreign ids', async () => {
      const mine = await create('Kinh doanh');
      const theirs = await create('Kinh doanh', outsider);
      await fail('put', `/members/${alice.memberId}/department`, owner, 404, { departmentId: NIL });
      await fail('put', `/members/${alice.memberId}/department`, owner, 404, { departmentId: 'x' });
      await fail('put', `/members/${alice.memberId}/department`, owner, 404, {
        departmentId: theirs.id,
      });
      await fail('put', `/members/${NIL}/department`, owner, 404, { departmentId: mine.id });
      await fail('put', `/members/${outsider.memberId}/department`, owner, 404, {
        departmentId: mine.id,
      });
      await fail('put', `/agents/${agentId}/department`, owner, 404, { departmentId: theirs.id });
      await fail('put', `/agents/${NIL}/department`, owner, 404, { departmentId: mine.id });
      await fail('put', `/agents/${agentId}/department`, outsider, 404, {
        departmentId: theirs.id,
      });
      await fail('put', `/members/${alice.memberId}/department`, owner, 400, {});
      expect((await memberOf(alice.memberId)).departmentId).toBeNull();
    });

    it('does not move a removed member', async () => {
      const mine = await create('Kinh doanh');
      await call('delete', `/members/${bob.memberId}`, owner);
      await fail('put', `/members/${bob.memberId}/department`, owner, 404, {
        departmentId: mine.id,
      });
    });
  });

  // ---------- titles ----------
  describe('titles', () => {
    it('lets people set their own through PATCH /me', async () => {
      const session = await call<Session>('patch', '/me', alice, { title: '  Nhân viên CSKH ' });
      expect(session.user.title).toBe('Nhân viên CSKH');
      expect((await memberOf(alice.memberId)).title).toBe('Nhân viên CSKH');
      // Other fields keep working and leave the title alone.
      const renamed = await call<Session>('patch', '/me', alice, { name: 'Alice' });
      expect(renamed.user.title).toBe('Nhân viên CSKH');
      const cleared = await call<Session>('patch', '/me', alice, { title: '   ' });
      expect(cleared.user.title).toBeNull();
      await call('patch', '/me', alice, { title: 'Lead' });
      const nulled = await call<Session>('patch', '/me', alice, { title: null });
      expect(nulled.user.title).toBeNull();
      await fail('patch', '/me', alice, 400, { title: 'x'.repeat(81) });
      expect(await audit()).toContain('member.title_changed');
    });

    it('lets owner and admin set anyone, and a member only their own', async () => {
      const set = await call<Member>('put', `/members/${alice.memberId}/title`, admin, {
        title: ' Trưởng phòng Kinh doanh ',
      });
      expect(set.title).toBe('Trưởng phòng Kinh doanh');
      await call('put', `/members/${admin.memberId}/title`, owner, { title: 'Quản lý' });
      await fail('put', `/members/${alice.memberId}/title`, bob, 403, { title: 'Boss' });
      expect((await memberOf(alice.memberId)).title).toBe('Trưởng phòng Kinh doanh');
      const cleared = await call<Member>('put', `/members/${alice.memberId}/title`, owner, {
        title: null,
      });
      expect(cleared.title).toBeNull();
      const emptied = await call<Member>('put', `/members/${admin.memberId}/title`, owner, {
        title: '',
      });
      expect(emptied.title).toBeNull();
    });

    it('validates and isolates workspaces', async () => {
      await fail('put', `/members/${alice.memberId}/title`, owner, 400, { title: 'x'.repeat(81) });
      await fail('put', `/members/${alice.memberId}/title`, owner, 400, {});
      await fail('put', `/members/${alice.memberId}/title`, owner, 400, { title: 5 });
      await fail('put', `/members/${NIL}/title`, owner, 404, { title: 'A' });
      await fail('put', `/members/${outsider.memberId}/title`, owner, 404, { title: 'A' });
      await fail('put', `/members/${alice.memberId}/title`, outsider, 404, { title: 'A' });
    });

    it('shows department and title on the people lists and the session', async () => {
      const dept = await create('Kinh doanh');
      await call('put', `/members/${alice.memberId}/department`, owner, { departmentId: dept.id });
      await call('put', `/members/${alice.memberId}/title`, owner, { title: 'Sales' });
      expect(await memberOf(alice.memberId)).toMatchObject({
        departmentId: dept.id,
        title: 'Sales',
      });
      const session = await call<Session>('get', '/session', alice);
      expect(session.user).toMatchObject({ departmentId: dept.id, title: 'Sales' });
      expect(await memberOf(owner.memberId)).toMatchObject({ departmentId: null, title: null });
    });
  });

  // ---------- invites ----------
  describe('invites', () => {
    const invite = (body: object, client = owner) =>
      request(app.getHttpServer()).post('/api/v1/invites').set(client.bearer).send(body);
    const accept = async (token: string, name = 'Newbie'): Promise<AuthResult> => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/invites/accept')
        .send({ token, name, password: PASSWORD, acceptTerms: true })
        .expect(201);
      return (response.body as ApiResponse<AuthResult>).data;
    };

    it('carries the department and title onto the new member, who joins the room', async () => {
      const dept = await create('Kinh doanh');
      const created = (
        (
          await invite({
            email: 'new@example.com',
            role: 'member',
            departmentId: dept.id,
            title: ' Nhân viên Kinh doanh ',
          }).expect(201)
        ).body as ApiResponse<CreateInviteResult>
      ).data;
      expect(created.invite).toMatchObject({
        departmentId: dept.id,
        title: 'Nhân viên Kinh doanh',
      });
      expect((await call<Invite[]>('get', '/invites', owner))[0]).toMatchObject({
        departmentId: dept.id,
      });
      realtime = [];

      const joined = await accept(created.token);
      expect(joined.session.user).toMatchObject({
        departmentId: dept.id,
        title: 'Nhân viên Kinh doanh',
      });
      expect(await memberOf(joined.session.user.id)).toMatchObject({
        departmentId: dept.id,
        title: 'Nhân viên Kinh doanh',
      });
      expect(await roomsOfMember(joined.session.user.id)).toContain('kinh-doanh');
      expect(eventTypes()).toEqual(
        expect.arrayContaining(['members.changed', 'departments.changed']),
      );
    });

    it('still works without a department or title', async () => {
      const created = (
        (await invite({ email: 'plain@example.com', role: 'member' }).expect(201))
          .body as ApiResponse<CreateInviteResult>
      ).data;
      expect(created.invite).toMatchObject({ departmentId: null, title: null });
      const joined = await accept(created.token);
      expect(joined.session.user).toMatchObject({ departmentId: null, title: null });
    });

    it('rejects an unknown, deleted or foreign department and a long title', async () => {
      const dept = await create('Kinh doanh');
      const theirs = await create('Kinh doanh', outsider);
      await invite({ email: 'a@example.com', role: 'member', departmentId: NIL }).expect(404);
      await invite({ email: 'a@example.com', role: 'member', departmentId: 'x' }).expect(404);
      await invite({ email: 'a@example.com', role: 'member', departmentId: theirs.id }).expect(404);
      await invite({
        email: 'a@example.com',
        role: 'member',
        title: 'x'.repeat(81),
      }).expect(400);
      await call('delete', `/departments/${dept.id}`, owner);
      await invite({ email: 'a@example.com', role: 'member', departmentId: dept.id }).expect(404);
    });

    it('drops the department when it was deleted after the invite', async () => {
      const dept = await create('Kinh doanh');
      const created = (
        (
          await invite({
            email: 'late@example.com',
            role: 'member',
            departmentId: dept.id,
            title: 'T',
          }).expect(201)
        ).body as ApiResponse<CreateInviteResult>
      ).data;
      await call('delete', `/departments/${dept.id}`, owner);
      const joined = await accept(created.token);
      expect(joined.session.user).toMatchObject({ departmentId: null, title: 'T' });
    });
  });

  // ---------- audit ----------
  it('audits every department write', async () => {
    const a = await create('Kinh doanh');
    await call('patch', `/departments/${a.id}`, owner, { icon: 'chart' });
    await call('put', '/departments/order', owner, { ids: [a.id] });
    await call('put', `/members/${alice.memberId}/department`, owner, { departmentId: a.id });
    await call('put', `/members/${alice.memberId}/title`, owner, { title: 'Sales' });
    await call('put', `/agents/${agentId}/department`, owner, { departmentId: a.id });
    await call('delete', `/departments/${a.id}`, owner);
    expect(await audit()).toEqual(
      expect.arrayContaining([
        'department.created',
        'room.created',
        'department.updated',
        'department.reordered',
        'member.department_changed',
        'member.title_changed',
        'agent.department_changed',
        'department.deleted',
      ]),
    );
  });
});

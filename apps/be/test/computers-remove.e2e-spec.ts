// Must come first: the spec runs the in-process agent simulator (see simulator-env).
import './utils/simulator-env';
import { INestApplication } from '@nestjs/common';
import type { ApiResponse, Message, Room } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { Computer } from '../src/modules/computers/entities/computer.entity';
import { SimulatorTaskRunner } from '../src/modules/simulator/simulator-task-runner.service';
import { SimulatorService } from '../src/modules/simulator/simulator.service';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import {
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  truncateAll,
} from './utils';

describe('Removing computers, demo ones included (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let engine: TaskEngineService;
  let me: LoggedInClient;
  let demo: Computer;
  let real: Computer;
  let agent: Agent;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    engine = app.get(TaskEngineService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await engine.settled();
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
    await setPlan(dataSource, me.workspaceId, 'pro');
    demo = await createComputer(dataSource, me.workspaceId, { simulated: true, name: 'demo' });
    real = await createComputer(dataSource, me.workspaceId, { name: 'real' });
    agent = await createAgent(dataSource, me.workspaceId, demo.id, { name: 'Claude' });
  });

  const http = () => request(app.getHttpServer());
  const remove = (id: string, query = '') =>
    http().delete(`/api/v1/computers/${id}${query}`).set(me.bearer);
  const get = async <T>(path: string) =>
    ((await http().get(`/api/v1${path}`).set(me.bearer).expect(200)).body as ApiResponse<T>).data;
  const dm = async () =>
    (
      (await http().post(`/api/v1/agents/${agent.id}/dm`).set(me.bearer).expect(200))
        .body as ApiResponse<{ chatId: string }>
    ).data.chatId;
  const auditMeta = async () =>
    (
      await dataSource.query<Array<{ meta: Record<string, number> }>>(
        `SELECT meta FROM audit_events WHERE action = 'computer.revoked'`,
      )
    )[0]?.meta;

  it('moves the agents to another computer: same id, same DM history, workdir kept', async () => {
    const chatId = await dm();
    await http()
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(me.bearer)
      .send({ markdown: 'hello before' })
      .expect(200);
    const ids = async () => (await get<Message[]>(`/chats/${chatId}/messages`)).map((m) => m.id);
    const before = await ids();
    expect(before.length).toBeGreaterThan(0);

    await remove(demo.id, `?moveAgentsTo=${real.id}`).expect(200);

    const moved = await dataSource.getRepository(Agent).findOneByOrFail({ id: agent.id });
    expect(moved.computerId).toBe(real.id);
    expect(moved.workdir).toBe(agent.workdir);
    expect(await ids()).toEqual(before);
    expect((await get<Room[]>('/rooms')).some((r) => r.id === chatId)).toBe(true);
    const list = await get<Array<{ id: string; revokedAt: string | null }>>('/computers');
    expect(list.find((c) => c.id === demo.id)?.revokedAt).toEqual(expect.any(String));
    expect(await auditMeta()).toMatchObject({ movedAgents: 1, deletedAgents: 0 });
  });

  it('deletes the agents of a demo computer when nothing is chosen', async () => {
    const chatId = await dm();
    await remove(demo.id).expect(200);
    expect(await dataSource.getRepository(Agent).findOneBy({ id: agent.id })).toBeNull();
    expect(
      await dataSource.getRepository(Agent).findOne({ where: { id: agent.id }, withDeleted: true }),
    ).toMatchObject({ computerId: demo.id });
    expect((await get<Room[]>('/rooms')).some((r) => r.id === chatId)).toBe(false);
    expect(await auditMeta()).toMatchObject({ movedAgents: 0, deletedAgents: 1 });
  });

  it('answers 400 for an invalid target and leaves everything as it was', async () => {
    const other = await createComputer(dataSource, me.workspaceId, {
      name: 'gone',
      revokedAt: new Date(),
    });
    const stranger = await registerAndLogin(app);
    const foreign = await createComputer(dataSource, stranger.workspaceId, {});
    for (const target of [demo.id, other.id, foreign.id, 'not-a-uuid']) {
      await remove(demo.id, `?moveAgentsTo=${target}`).expect(400);
    }
    expect(
      (await dataSource.getRepository(Computer).findOneByOrFail({ id: demo.id })).revokedAt,
    ).toBeNull();
    expect(await dataSource.getRepository(Agent).count()).toBe(1);
  });

  it('keeps the agents of a revoked real computer attached (unchanged)', async () => {
    const onReal = await createAgent(dataSource, me.workspaceId, real.id, { name: 'Real one' });
    await remove(real.id).expect(200);
    expect(
      (await dataSource.getRepository(Agent).findOneByOrFail({ id: onReal.id })).computerId,
    ).toBe(real.id);
    expect(await auditMeta()).toMatchObject({ movedAgents: 0, deletedAgents: 0 });
  });

  it('can move the agents of a real computer to a demo one', async () => {
    const onReal = await createAgent(dataSource, me.workspaceId, real.id, { name: 'Real one' });
    await remove(real.id, `?moveAgentsTo=${demo.id}`).expect(200);
    expect(
      (await dataSource.getRepository(Agent).findOneByOrFail({ id: onReal.id })).computerId,
    ).toBe(demo.id);
  });

  it('keeps the simulator away from a removed demo computer', async () => {
    await remove(demo.id, `?moveAgentsTo=${real.id}`).expect(200);
    await app.get(SimulatorService).beat();
    await app.get(SimulatorTaskRunner).runPass();
    const row = await dataSource.getRepository(Computer).findOneByOrFail({ id: demo.id });
    expect(row.status).toBe('offline');
    expect(row.revokedAt).not.toBeNull();
  });

  it('refuses moving demo agents onto a real computer past the plan limit, revoking nothing', async () => {
    await setPlan(dataSource, me.workspaceId, 'free');
    await createAgent(dataSource, me.workspaceId, real.id, { name: 'R1' });
    await createAgent(dataSource, me.workspaceId, real.id, { name: 'R2' });
    const res = await remove(demo.id, `?moveAgentsTo=${real.id}`).expect(403);
    expect((res.body as { message: string }).message).toEqual(expect.any(String));
    expect(
      (await dataSource.getRepository(Computer).findOneByOrFail({ id: demo.id })).revokedAt,
    ).toBeNull();
    expect(
      (await dataSource.getRepository(Agent).findOneByOrFail({ id: agent.id })).computerId,
    ).toBe(demo.id);
    // The same gap through PATCH /agents/:id.
    await http()
      .patch(`/api/v1/agents/${agent.id}`)
      .set(me.bearer)
      .send({ computerId: real.id })
      .expect(403);
  });

  it('a retried DELETE on an already revoked computer still moves the remaining agents', async () => {
    const onReal = await createAgent(dataSource, me.workspaceId, real.id, { name: 'Real one' });
    await remove(real.id).expect(200);
    const revokedAt = (await dataSource.getRepository(Computer).findOneByOrFail({ id: real.id }))
      .revokedAt;
    expect(revokedAt).not.toBeNull();
    await remove(real.id, `?moveAgentsTo=${demo.id}`).expect(200);
    expect(
      (await dataSource.getRepository(Agent).findOneByOrFail({ id: onReal.id })).computerId,
    ).toBe(demo.id);
    expect(
      (await dataSource.getRepository(Computer).findOneByOrFail({ id: real.id })).revokedAt,
    ).toEqual(revokedAt);
  });
});

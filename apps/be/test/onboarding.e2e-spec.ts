import { INestApplication } from '@nestjs/common';
import { CliStatus, Session } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { SIMULATED_CONNECT_DELAY_MS } from '../src/contacts';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { Computer } from '../src/modules/computers/entities/computer.entity';
import { ClockService } from '../src/common/clock';
import './utils/simulator-env';
import {
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  TestClock,
  truncateAll,
} from './utils';

const unwrap = <T>(response: request.Response): T => (response.body as { data: T }).data;

describe('Onboarding with the simulator (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let clock: TestClock;
  let me: LoggedInClient;

  beforeAll(async () => {
    clock = new TestClock();
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app, { name: 'Ada' });
  });

  const http = () => request(app.getHttpServer());
  const cliStatus = async (client = me) =>
    unwrap<CliStatus>(
      await http().get('/api/v1/onboarding/cli-status').set(client.bearer).expect(200),
    );

  it('creates one simulated computer and agent, and connects after the delay', async () => {
    expect(await cliStatus()).toEqual({ connected: false, computerId: null });
    expect(await cliStatus()).toEqual({ connected: false, computerId: null });

    const computers = await dataSource.getRepository(Computer).find();
    expect(computers).toHaveLength(1);
    expect(computers[0]).toMatchObject({
      workspaceId: me.workspaceId,
      name: 'Ada-MacBook-Pro',
      os: 'macOS 26.1 · arm64',
      cliVersion: '2.1.0',
      status: 'online',
      simulated: true,
    });
    const agents = await dataSource.getRepository(Agent).find();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'Claude',
      avatar: 0,
      computerId: computers[0].id,
      workdir: '~/workspace',
      provider: 'claude-code',
      maxTurns: 40,
    });
    expect(agents[0].skills.length).toBeGreaterThan(0);

    clock.advance(SIMULATED_CONNECT_DELAY_MS - 100);
    expect((await cliStatus()).connected).toBe(false);
    clock.advance(200);
    expect(await cliStatus()).toEqual({ connected: true, computerId: computers[0].id });
  });

  it('creates the setup once under concurrent polls', async () => {
    await Promise.all(Array.from({ length: 6 }, () => cliStatus()));
    expect(await dataSource.getRepository(Computer).count()).toBe(1);
    expect(await dataSource.getRepository(Agent).count()).toBe(1);
  });

  it('does not create a simulated computer when the workspace already has one', async () => {
    const real = await createComputer(dataSource, me.workspaceId, { name: 'mine' });
    expect(await cliStatus()).toEqual({ connected: true, computerId: real.id });
    expect(await dataSource.getRepository(Computer).count()).toBe(1);

    await dataSource.getRepository(Computer).update({ id: real.id }, { status: 'offline' });
    expect(await cliStatus()).toEqual({ connected: false, computerId: null });
    expect(await dataSource.getRepository(Computer).count()).toBe(1);
  });

  it('keeps workspaces separate', async () => {
    const other = await registerAndLogin(app);
    await cliStatus();
    expect(await cliStatus(other)).toEqual({ connected: false, computerId: null });
    expect(await dataSource.getRepository(Computer).count()).toBe(2);
  });

  it('completes onboarding idempotently and reflects it in /session', async () => {
    const session = async () =>
      unwrap<Session>(await http().get('/api/v1/session').set(me.bearer).expect(200));
    expect((await session()).onboarded).toBe(false);

    const first = unwrap<Session>(
      await http().post('/api/v1/onboarding/complete').set(me.bearer).expect(200),
    );
    expect(first.onboarded).toBe(true);
    const stamp = (
      await dataSource.query<{ onboarded_at: Date }[]>(
        'SELECT onboarded_at FROM workspaces WHERE id = $1',
        [me.workspaceId],
      )
    )[0].onboarded_at;

    clock.advance(60_000);
    const second = unwrap<Session>(
      await http().post('/api/v1/onboarding/complete').set(me.bearer).expect(200),
    );
    expect(second.onboarded).toBe(true);
    expect((await session()).onboarded).toBe(true);
    const after = (
      await dataSource.query<{ onboarded_at: Date }[]>(
        'SELECT onboarded_at FROM workspaces WHERE id = $1',
        [me.workspaceId],
      )
    )[0].onboarded_at;
    expect(after.getTime()).toBe(stamp.getTime());
  });
});

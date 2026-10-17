import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  truncateAll,
} from './utils';

describe('Roles (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: LoggedInClient;
  let admin: LoggedInClient;
  let member: LoggedInClient;
  let agentId: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
    admin = await addMemberWithRole(dataSource, owner, 'admin');
    member = await addMemberWithRole(dataSource, owner, 'member');
    const computer = await createComputer(dataSource, owner.workspaceId);
    agentId = (await createAgent(dataSource, owner.workspaceId, computer.id)).id;
  });

  const send = (
    method: 'put' | 'post' | 'delete' | 'patch',
    path: string,
    client: LoggedInClient,
    body?: object,
  ) => request(app.getHttpServer())[method](`/api/v1${path}`).set(client.bearer).send(body);

  const connectBody = () => ({ account: 'shop', roomName: 'inbox', agentId, mode: 'draft' });

  const guarded: {
    name: string;
    method: 'put' | 'post' | 'delete' | 'patch';
    path: () => string;
    body?: () => object;
  }[] = [
    {
      name: 'PUT /scheduler',
      method: 'put',
      path: () => '/scheduler',
      body: () => ({ paused: true }),
    },
    {
      name: 'POST /connections/:id/authorize',
      method: 'post',
      path: () => '/connections/zalo/authorize',
    },
    {
      name: 'POST /connections/:id/connect',
      method: 'post',
      path: () => '/connections/zalo/connect',
      body: connectBody,
    },
    { name: 'DELETE /connections/:id', method: 'delete', path: () => '/connections/zalo' },
    {
      name: 'PATCH /agents/:id',
      method: 'patch',
      path: () => `/agents/${agentId}`,
      body: () => ({ persona: 'Be brief' }),
    },
  ];

  it.each(guarded)('$name answers 403 to a member', async ({ method, path, body }) => {
    const response = await send(method, path(), member, body?.());
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'You do not have permission to do this',
    });
    const vi = await send(method, `${path()}?lang=vi`, member, body?.());
    expect((vi.body as { message: string }).message).toBe(
      'Bạn không có quyền thực hiện thao tác này',
    );
  });

  it.each(guarded)('$name is open to admins and owners', async ({ method, path, body }) => {
    for (const client of [admin, owner]) {
      const response = await send(method, path(), client, body?.());
      expect(response.status).toBeLessThan(300);
    }
  });

  it('leaves reads and task approval to members', async () => {
    for (const path of ['/scheduler', '/agents', '/connections', '/dashboard']) {
      await request(app.getHttpServer()).get(`/api/v1${path}`).set(member.bearer).expect(200);
    }
    // approving is not role-gated: a missing task is a 404, never a 403
    await send('post', '/tasks/AG-0/approve', member).expect(404);
  });
});

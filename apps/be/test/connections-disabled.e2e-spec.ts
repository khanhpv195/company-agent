import './utils/connections-disabled-env';
import { INestApplication } from '@nestjs/common';
import type { ApiResponse, Connection } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, LoggedInClient, registerAndLogin, truncateAll } from './utils';

describe('Connections with CONNECTIONS_MODE=disabled (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let me: LoggedInClient;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
  });

  it('lists the catalog as unavailable', async () => {
    const res = await http().get('/api/v1/connections').set(me.bearer).expect(200);
    const connections = (res.body as ApiResponse<Connection[]>).data;
    expect(connections).toHaveLength(3);
    for (const connection of connections) expect(connection.availability).toBe('unavailable');
  });

  it('answers 409 connections.UNAVAILABLE to authorize and connect', async () => {
    const authorize = await http()
      .post('/api/v1/connections/zalo/authorize')
      .set(me.bearer)
      .expect(409);
    expect((authorize.body as { message: string }).message).toBe(
      'Connections are not available on this server yet',
    );
    const connect = await http()
      .post('/api/v1/connections/gmail/connect')
      .set(me.bearer)
      .set('Accept-Language', 'vi')
      .send({ account: 'a', roomName: 'r', agentId: me.memberId, mode: 'draft' })
      .expect(409);
    expect((connect.body as { message: string }).message).toBe('Máy chủ này chưa hỗ trợ kết nối');
  });

  it('still lets an admin disconnect (nothing to clean up here)', async () => {
    await http().delete('/api/v1/connections/zalo').set(me.bearer).expect(200);
  });
});

import './utils/billing-limits-off-env';
import { INestApplication } from '@nestjs/common';
import type { BillingSummary } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  truncateAll,
} from './utils';

const API = '/api/v1';

/** `BILLING_LIMITS_ENABLED=false` (default outside the test env): free workspaces are unlimited. */
describe('Billing with plan limits off (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: LoggedInClient;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(dataSource);
    owner = await registerAndLogin(app);
  });

  it('reports limitsEnabled false on a free workspace', async () => {
    const res = await http().get(`${API}/billing`).set(owner.bearer).expect(200);
    expect((res.body as { data: BillingSummary }).data).toMatchObject({
      plan: 'free',
      limitsEnabled: false,
    });
  });

  it('lets a free workspace pass the agent, seat and computer limits', async () => {
    const computer = await createComputer(dataSource, owner.workspaceId);
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await http()
        .post(`${API}/agents`)
        .set(owner.bearer)
        .send({ name, computerId: computer.id })
        .expect(200);
    }
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) {
      await http()
        .post(`${API}/invites`)
        .set(owner.bearer)
        .send({ email, role: 'member' })
        .expect(201);
    }
    // free allows 1 computer: a pairing code is still issued and consumed with one already paired
    for (let i = 0; i < 2; i++) {
      const code = await http()
        .post(`${API}/computers/pairing-codes`)
        .set(owner.bearer)
        .expect(200);
      await http()
        .post(`${API}/gateway/pair`)
        .send({
          code: (code.body as { data: { code: string } }).data.code,
          name: `box-${i}`,
          os: 'Linux',
          cliVersion: '0.1.0',
        })
        .expect(200);
    }
    const summary = (await http().get(`${API}/billing`).set(owner.bearer).expect(200)).body as {
      data: BillingSummary;
    };
    expect(summary.data.limitsEnabled).toBe(false);
    expect(summary.data.usage.agents).toBe(4);
    expect(summary.data.usage.seats).toBe(5);
    expect(summary.data.usage.computers).toBe(3);
  });
});

import { INestApplication } from '@nestjs/common';
import type { BillingSummary } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, LoggedInClient, registerAndLogin, truncateAll } from './utils';

/** Default provider (`BILLING_PROVIDER=none`): limits and usage work, Stripe routes say no. */
describe('Billing without a provider (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: LoggedInClient;

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

  const http = () => request(app.getHttpServer());

  it('reports checkoutAvailable false and still serves the summary', async () => {
    const res = await http().get('/api/v1/billing').set(owner.bearer).expect(200);
    const data = (res.body as { data: BillingSummary }).data;
    expect(data).toMatchObject({ plan: 'free', checkoutAvailable: false, subscription: null });
    expect(data.usage).toEqual({ seats: 1, agents: 0, computers: 0 });
  });

  it('answers 409 billing.UNAVAILABLE for checkout, portal and the webhook', async () => {
    const checkout = await http()
      .post('/api/v1/billing/checkout')
      .set(owner.bearer)
      .send({ plan: 'pro' })
      .expect(409);
    expect((checkout.body as { message: string }).message).toBe(
      'Online billing is not available on this server',
    );
    await http().post('/api/v1/billing/portal').set(owner.bearer).expect(409);
    await http()
      .post('/api/v1/billing/webhook')
      .set('Stripe-Signature', 't=1,v1=x')
      .send({ id: 'evt_1' })
      .expect(409);
  });
});

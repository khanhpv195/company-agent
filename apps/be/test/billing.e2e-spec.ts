// Must come first: switches the Stripe provider on (see billing-env).
import './utils/billing-env';

import { INestApplication } from '@nestjs/common';
import type { AuditEvent, BillingSummary, CreateInviteResult } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import { StripeGateway } from '../src/modules/billing/stripe.gateway';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  FakeStripeGateway,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  STRIPE_E2E,
  truncateAll,
} from './utils';

const API = '/api/v1';
const PASSWORD = 'correct-horse-battery1';

interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
  meta?: { details?: Record<string, unknown>; statusCode?: number };
}

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const stripe = new FakeStripeGateway();
  const signer = new Stripe('sk_test_e2e');
  let owner: LoggedInClient;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(StripeGateway).useValue(stripe),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    stripe.reset();
    owner = await registerAndLogin(app, { name: 'Olive', email: 'olive@example.com' });
  });

  const http = () => request(app.getHttpServer());
  const body = <T>(response: { body: unknown }) => response.body as Envelope<T>;

  const invite = (client: LoggedInClient, email: string, headers: Record<string, string> = {}) =>
    http().post(`${API}/invites`).set(client.bearer).set(headers).send({ email, role: 'member' });
  const summary = async (client = owner) =>
    body<BillingSummary>(await http().get(`${API}/billing`).set(client.bearer).expect(200)).data;
  const workspaceRow = async () =>
    (
      await dataSource.query<
        {
          plan: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: string | null;
          cancel_at_period_end: boolean;
          current_period_end: Date | null;
        }[]
      >('SELECT * FROM workspaces WHERE id = $1', [owner.workspaceId])
    )[0];
  const auditActions = async (): Promise<AuditEvent[]> =>
    body<AuditEvent[]>(
      await http().get(`${API}/audit-events?limit=100`).set(owner.bearer).expect(200),
    ).data;

  const pairingCode = async (client = owner, status = 200) => {
    const res = await http().post(`${API}/computers/pairing-codes`).set(client.bearer);
    expect(res.status).toBe(status);
    return res;
  };
  const pair = (code: string, name = 'box') =>
    http().post(`${API}/gateway/pair`).send({ code, name, os: 'Linux', cliVersion: '0.1.0' });
  const codeOf = (res: { body: unknown }) => body<{ code: string }>(res).data.code;

  describe('seat limit', () => {
    it('stops invites at the plan limit with the code, message and details', async () => {
      // free: 3 seats, the owner holds one
      await invite(owner, 'a@example.com').expect(201);
      await invite(owner, 'b@example.com').expect(201);
      const refused = await invite(owner, 'c@example.com').expect(403);
      expect(body(refused).message).toBe(
        'The free plan allows up to 3 members (seats). Upgrade your plan to add more.',
      );
      expect(body(refused).meta?.details).toEqual({
        resource: 'seats',
        limit: 3,
        used: 3,
        plan: 'free',
      });
      expect((await summary()).usage.seats).toBe(3);

      // the message follows the request language
      const vi = await invite(owner, 'c@example.com', { 'Accept-Language': 'vi' }).expect(403);
      expect(body(vi).message).toBe(
        'Gói free chỉ cho tối đa 3 thành viên (chỗ ngồi). Hãy nâng cấp gói để thêm.',
      );

      await setPlan(dataSource, owner.workspaceId, 'pro');
      await invite(owner, 'c@example.com').expect(201);
    });

    it('does not count a replaced invite twice, and a revoked one frees its seat', async () => {
      await invite(owner, 'a@example.com').expect(201);
      const second = body<CreateInviteResult>(await invite(owner, 'b@example.com').expect(201));
      await invite(owner, 'a@example.com').expect(201); // replaces: still 3 seats
      await invite(owner, 'c@example.com').expect(403);
      await http().delete(`${API}/invites/${second.data.invite.id}`).set(owner.bearer).expect(200);
      await invite(owner, 'c@example.com').expect(201);
    });

    it('counts members, ignores removed ones and expired invites', async () => {
      const extra = await addMemberWithRole(dataSource, owner, 'member');
      await addMemberWithRole(dataSource, owner, 'member'); // 3 members
      await invite(owner, 'a@example.com').expect(403);
      await http().delete(`${API}/members/${extra.memberId}`).set(owner.bearer).expect(200);
      await invite(owner, 'a@example.com').expect(201);
      await dataSource.query(`UPDATE invites SET expires_at = now() - interval '1 day'`);
      await invite(owner, 'b@example.com').expect(201);
    });

    it('refuses to accept an invite when the workspace has no seat left, keeping the invite', async () => {
      await setPlan(dataSource, owner.workspaceId, 'pro');
      const created = body<CreateInviteResult>(await invite(owner, 'late@example.com').expect(201));
      await addMemberWithRole(dataSource, owner, 'member');
      await addMemberWithRole(dataSource, owner, 'member');
      await setPlan(dataSource, owner.workspaceId, 'free'); // downgrade: nothing is deleted

      const accept = () =>
        http()
          .post(`${API}/invites/accept`)
          .send({ token: created.data.token, name: 'Late', password: PASSWORD, acceptTerms: true });
      const refused = await accept().expect(403);
      expect(body(refused).meta?.details).toMatchObject({ resource: 'seats', limit: 3, used: 3 });
      await http().get(`${API}/invites/preview?token=${created.data.token}`).expect(200); // not burned

      await setPlan(dataSource, owner.workspaceId, 'pro');
      await accept().expect(201);
    });

    it('never lets parallel invites pass the limit', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => invite(owner, `p${i}@example.com`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 403)).toHaveLength(4);
      expect((await summary()).usage.seats).toBe(3);
    });
  });

  describe('agent limit', () => {
    const create = (name: string, computerId: string, client = owner) =>
      http().post(`${API}/agents`).set(client.bearer).send({ name, computerId });

    it('stops agent creation at the limit; deleted agents free their slot', async () => {
      const computer = await createComputer(dataSource, owner.workspaceId);
      const first = await create('One', computer.id).expect(200);
      await create('Two', computer.id).expect(200);
      const refused = await create('Three', computer.id).expect(403);
      expect(body(refused).message).toBe(
        'The free plan allows up to 2 agents. Upgrade your plan to add more.',
      );
      expect(body(refused).meta?.details).toEqual({
        resource: 'agents',
        limit: 2,
        used: 2,
        plan: 'free',
      });

      await http()
        .delete(`${API}/agents/${body<{ id: string }>(first).data.id}`)
        .set(owner.bearer)
        .expect(200);
      await create('Three', computer.id).expect(200);
      await setPlan(dataSource, owner.workspaceId, 'pro');
      await create('Four', computer.id).expect(200);
    });

    it('never lets parallel creates pass the limit', async () => {
      const computer = await createComputer(dataSource, owner.workspaceId);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => create(`Agent ${i}`, computer.id)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(2);
      expect(results.filter((r) => r.status === 403)).toHaveLength(3);
    });
  });

  describe('agent limit and demo machines', () => {
    it('does not count the demo agent of a simulated computer', async () => {
      const demo = await createComputer(dataSource, owner.workspaceId, { simulated: true });
      await createAgent(dataSource, owner.workspaceId, demo.id, { name: 'Demo' });
      expect((await summary()).usage.agents).toBe(0);
      const computer = await createComputer(dataSource, owner.workspaceId);
      const create = (name: string) =>
        http().post(`${API}/agents`).set(owner.bearer).send({ name, computerId: computer.id });
      await create('One').expect(200);
      await create('Two').expect(200);
      await create('Three').expect(403);
      expect((await summary()).usage.agents).toBe(2);
    });
  });

  describe('team seat sync', () => {
    const makeTeam = () =>
      dataSource.query(
        `UPDATE workspaces SET plan = 'team', stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1',
           subscription_status = 'active' WHERE id = $1`,
        [owner.workspaceId],
      );

    it('sends the live member count after an invite is accepted and a member removed', async () => {
      await makeTeam();
      const created = body<CreateInviteResult>(await invite(owner, 'new@example.com').expect(201));
      expect(stripe.quantities).toEqual([]); // a pending invite is not billed
      await http()
        .post(`${API}/invites/accept`)
        .send({ token: created.data.token, name: 'New', password: PASSWORD, acceptTerms: true })
        .expect(201);
      expect(stripe.quantities).toEqual([{ id: 'sub_1', quantity: 2 }]);

      const extra = await addMemberWithRole(dataSource, owner, 'member');
      await http().delete(`${API}/members/${extra.memberId}`).set(owner.bearer).expect(200);
      expect(stripe.quantities.at(-1)).toEqual({ id: 'sub_1', quantity: 2 });
    });

    it('is best-effort: a Stripe error does not fail the change, and other plans never call', async () => {
      const extra = await addMemberWithRole(dataSource, owner, 'member');
      await http().delete(`${API}/members/${extra.memberId}`).set(owner.bearer).expect(200);
      expect(stripe.quantities).toEqual([]); // free workspace

      await makeTeam();
      stripe.failQuantity = true;
      const another = await addMemberWithRole(dataSource, owner, 'member');
      await http().delete(`${API}/members/${another.memberId}`).set(owner.bearer).expect(200);
      expect(stripe.quantities).toEqual([]);
      stripe.failQuantity = false;
      const third = await addMemberWithRole(dataSource, owner, 'member');
      await http().delete(`${API}/members/${third.memberId}`).set(owner.bearer).expect(200);
      expect(stripe.quantities).toEqual([{ id: 'sub_1', quantity: 1 }]); // retried on next change
    });
  });

  describe('team subscription lifecycle', () => {
    const makeTeam = () =>
      dataSource.query(
        `UPDATE workspaces SET plan = 'team', stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1',
           subscription_status = 'active' WHERE id = $1`,
        [owner.workspaceId],
      );
    const workspaceName = async () =>
      (
        await dataSource.query<{ name: string }[]>('SELECT name FROM workspaces WHERE id = $1', [
          owner.workspaceId,
        ])
      )[0].name;
    const workspaceExists = async () =>
      (
        await dataSource.query<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM workspaces WHERE id = $1',
          [owner.workspaceId],
        )
      )[0].n === 1;
    const deleteWorkspace = async () =>
      http()
        .delete(`${API}/workspace`)
        .set(owner.bearer)
        .send({ password: PASSWORD, confirmName: await workspaceName() });

    it('cancels the live subscription before deleting the workspace', async () => {
      await makeTeam();
      await deleteWorkspace().then((r) => expect(r.status).toBe(200));
      expect(stripe.canceled).toEqual(['sub_1']);
      expect(await workspaceExists()).toBe(false);
    });

    it('refuses the delete with 409 when Stripe cannot cancel, leaving the workspace intact', async () => {
      await makeTeam();
      stripe.failCancel = true;
      const refused = await deleteWorkspace();
      expect(refused.status).toBe(409);
      expect(body(refused).message).toMatch(/cancel the subscription/);
      expect(await workspaceExists()).toBe(true);
      await http().get(`${API}/members`).set(owner.bearer).expect(200);

      stripe.failCancel = false;
      await deleteWorkspace().then((r) => expect(r.status).toBe(200));
      expect(stripe.canceled).toEqual(['sub_1']);
    });

    it('calls Stripe outside any transaction: the workspace row stays lockable meanwhile', async () => {
      await makeTeam();
      let locked = false;
      stripe.onCancel = async () => {
        const runner = dataSource.createQueryRunner();
        try {
          await runner.query("SET lock_timeout = '500ms'");
          await runner.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE NOWAIT', [
            owner.workspaceId,
          ]);
          await runner.query('SELECT pg_try_advisory_lock(hashtext($1::text))', [
            owner.workspaceId,
          ]);
          await runner.query('SELECT pg_advisory_unlock(hashtext($1::text))', [owner.workspaceId]);
          locked = true;
        } finally {
          await runner.release();
        }
      };
      await deleteWorkspace().then((r) => expect(r.status).toBe(200));
      expect(locked).toBe(true);
      expect(stripe.canceled).toEqual(['sub_1']);
    });

    it('does not call Stripe for a workspace without a live subscription', async () => {
      await dataSource.query(
        `UPDATE workspaces SET stripe_subscription_id = 'sub_old', subscription_status = 'canceled' WHERE id = $1`,
        [owner.workspaceId],
      );
      await deleteWorkspace().then((r) => expect(r.status).toBe(200));
      expect(stripe.canceled).toEqual([]);
    });

    it('bills live members at checkout (pending invites excluded) while the limit still counts them', async () => {
      await invite(owner, 'pending@example.com').expect(201);
      await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'team' })
        .expect(200);
      expect(stripe.checkouts[0]).toMatchObject({ priceId: STRIPE_E2E.priceTeam, quantity: 1 });
      expect((await summary()).usage.seats).toBe(2);
    });

    it('updates the Stripe customer email on ownership transfer, best-effort', async () => {
      await makeTeam();
      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      const [{ email }] = await dataSource.query<{ email: string }[]>(
        'SELECT email FROM members WHERE id = $1',
        [admin.memberId],
      );
      await http()
        .post(`${API}/workspace/transfer-ownership`)
        .set(owner.bearer)
        .send({ memberId: admin.memberId, password: PASSWORD })
        .expect(200);
      expect(stripe.emails).toEqual([{ customerId: 'cus_1', email }]);
    });

    it('does not fail the transfer when the Stripe email update fails', async () => {
      await makeTeam();
      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      stripe.failEmail = true;
      await http()
        .post(`${API}/workspace/transfer-ownership`)
        .set(owner.bearer)
        .send({ memberId: admin.memberId, password: PASSWORD })
        .expect(200);
      expect(stripe.emails).toEqual([]);
    });

    it('sends the new count when a member deletes their own account', async () => {
      await makeTeam();
      const created = body<CreateInviteResult>(
        await invite(owner, 'leaver@example.com').expect(201),
      );
      const accepted = await http()
        .post(`${API}/invites/accept`)
        .send({ token: created.data.token, name: 'Leaver', password: PASSWORD, acceptTerms: true })
        .expect(201);
      const token = (accepted.body as { data: { accessToken: string } }).data.accessToken;
      expect(stripe.quantities.at(-1)).toEqual({ id: 'sub_1', quantity: 2 });
      await http()
        .delete(`${API}/me`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ password: PASSWORD })
        .expect(200);
      expect(stripe.quantities.at(-1)).toEqual({ id: 'sub_1', quantity: 1 });
    });

    it('revokes the pairing codes of a member demoted to member', async () => {
      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      const code = codeOf(await pairingCode(admin));
      expect(code).toBeTruthy();
      await http()
        .patch(`${API}/members/${admin.memberId}`)
        .set(owner.bearer)
        .send({ role: 'member' })
        .expect(200);
      const [row] = await dataSource.query<{ used_at: Date | null }[]>(
        'SELECT used_at FROM pairing_codes WHERE created_by = $1',
        [admin.memberId],
      );
      expect(row.used_at).not.toBeNull();
      await pair(code).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    });
  });

  describe('computer limit', () => {
    it('stops pairing codes and pairing at the limit; revoked and demo computers do not count', async () => {
      await createComputer(dataSource, owner.workspaceId, { simulated: true, name: 'demo' });
      const code = codeOf(await pairingCode());
      const paired = body<{ computerId: string }>(await pair(code).expect(200));

      const refusedCode = await pairingCode(owner, 403);
      expect(body(refusedCode).message).toBe(
        'The free plan allows up to 1 computers. Upgrade your plan to add more.',
      );
      expect(body(refusedCode).meta?.details).toEqual({
        resource: 'computers',
        limit: 1,
        used: 1,
        plan: 'free',
      });
      expect((await summary()).usage.computers).toBe(1);

      await http()
        .delete(`${API}/computers/${paired.data.computerId}`)
        .set(owner.bearer)
        .expect(200);
      expect((await summary()).usage.computers).toBe(0);
      await pairingCode();
    });

    it('refuses /gateway/pair at the limit and keeps the code usable after an upgrade', async () => {
      const first = codeOf(await pairingCode());
      const second = codeOf(await pairingCode()); // both issued while 0 computers
      await pair(first).expect(200);
      const refused = await pair(second).expect(403);
      expect(body(refused).meta?.details).toMatchObject({ resource: 'computers', limit: 1 });

      await setPlan(dataSource, owner.workspaceId, 'pro');
      await pair(second, 'second').expect(200);
    });

    it('never lets parallel pairings pass the limit', async () => {
      const codes = [
        codeOf(await pairingCode()),
        codeOf(await pairingCode()),
        codeOf(await pairingCode()),
      ];
      const results = await Promise.all(codes.map((code) => pair(code)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 403)).toHaveLength(2);
    });
  });

  describe('GET /billing', () => {
    it('reports plan, limits, usage, the month and no Stripe ids (any member)', async () => {
      await setPlan(dataSource, owner.workspaceId, 'pro');
      await dataSource.query(
        `UPDATE workspaces SET stripe_customer_id = 'cus_secret' WHERE id = $1`,
        [owner.workspaceId],
      );
      const member = await addMemberWithRole(dataSource, owner, 'member');
      const result = await summary(member);
      expect(result).toMatchObject({
        plan: 'pro',
        limits: { seats: 10, agents: 10, computers: 5 },
        usage: { seats: 2, agents: 0, computers: 0 },
        costUsd: 0,
        runs: 0,
        byAgent: [],
        byDay: [],
        subscription: null,
        checkoutAvailable: true,
      });
      expect(JSON.stringify(result)).not.toContain('cus_secret');

      // calendar month in the workspace timezone (Asia/Ho_Chi_Minh, UTC+7, no DST)
      const local = new Date(Date.now() + 7 * 3_600_000);
      const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 7 * 3_600_000;
      const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 7 * 3_600_000;
      expect(result.period).toEqual({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
    });

    it('sums cost and runs of finished assignments in the period, in SQL', async () => {
      await setPlan(dataSource, owner.workspaceId, 'pro');
      const computer = await createComputer(dataSource, owner.workspaceId);
      const demo = await createComputer(dataSource, owner.workspaceId, { simulated: true });
      const a1 = await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Alpha' });
      const a2 = await createAgent(dataSource, owner.workspaceId, computer.id, { name: 'Beta' });
      const a3 = await createAgent(dataSource, owner.workspaceId, demo.id, { name: 'Demo' });

      const period = (await summary()).period;
      const at = (hours: number) => new Date(Date.parse(period.start) + hours * 3_600_000);
      const insert = (
        agentId: string,
        computerId: string,
        status: string,
        cost: number | null,
        endedAt: Date,
        kind = 'chat',
      ) =>
        dataSource.query(
          `INSERT INTO assignments (workspace_id, agent_id, computer_id, source_kind, source_id, status, cost_usd, ended_at)
           VALUES ($1, $2, $3, $4, gen_random_uuid()::text, $5, $6, $7)`,
          [owner.workspaceId, agentId, computerId, kind, status, cost, endedAt],
        );
      // day 1 (local): 0.5 + 0.25 on Alpha, null cost on Beta
      await insert(a1.id, computer.id, 'completed', 0.5, at(2));
      await insert(a1.id, computer.id, 'failed', 0.25, at(3), 'task');
      await insert(a2.id, computer.id, 'completed', null, at(4));
      // day 3: 1.125 on Beta
      await insert(a2.id, computer.id, 'completed', 1.125, at(24 * 2 + 5));
      // a cancelled / expired run that reports a cost still spent it: counted in cost, not in runs
      await insert(a1.id, computer.id, 'cancelled', 2, at(5));
      await insert(a2.id, computer.id, 'expired', 0.5, at(24 * 2 + 6));
      // not counted: before the month, after it, still running, cancelled without cost, demo machine
      await insert(a1.id, computer.id, 'completed', 9, new Date(Date.parse(period.start) - 1000));
      await insert(a1.id, computer.id, 'completed', 9, new Date(Date.parse(period.end)));
      await insert(a1.id, computer.id, 'running', 9, at(5));
      await insert(a1.id, computer.id, 'cancelled', null, at(5));
      await insert(a3.id, demo.id, 'completed', 9, at(5));

      const result = await summary();
      expect(result.costUsd).toBe(4.375);
      expect(result.runs).toBe(4); // finished runs: completed + failed
      expect(result.byAgent).toEqual([
        { agentId: a1.id, name: 'Alpha', costUsd: 2.75, runs: 2 },
        { agentId: a2.id, name: 'Beta', costUsd: 1.625, runs: 2 },
      ]);
      expect(result.byDay).toHaveLength(2);
      expect(result.byDay[0]).toMatchObject({ costUsd: 2.75, runs: 3 });
      expect(result.byDay[1]).toMatchObject({ costUsd: 1.625, runs: 1 });
      expect(result.byDay[0].date < result.byDay[1].date).toBe(true);
      expect(result.byDay[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('is isolated per workspace and needs a login', async () => {
      await http().get(`${API}/billing`).expect(401);
      const other = await registerAndLogin(app, { email: 'other@example.com' });
      await setPlan(dataSource, other.workspaceId, 'team');
      expect((await summary(other)).plan).toBe('team');
      expect((await summary()).plan).toBe('free');
    });
  });

  describe('checkout and portal', () => {
    it('lets only the owner start a checkout and sends the right Stripe parameters', async () => {
      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      await http()
        .post(`${API}/billing/checkout`)
        .set(admin.bearer)
        .send({ plan: 'pro' })
        .expect(403);
      await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'free' })
        .expect(400);
      await http().post(`${API}/billing/checkout`).send({ plan: 'pro' }).expect(401);

      const pro = await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'pro' })
        .expect(200);
      expect(body<{ url: string }>(pro).data.url).toBe('https://checkout.stripe.test/c/1');
      expect(stripe.checkouts[0]).toMatchObject({
        priceId: STRIPE_E2E.pricePro,
        quantity: 1,
        workspaceId: owner.workspaceId,
        customerId: null,
        customerEmail: 'olive@example.com',
        successUrl: 'http://localhost:1420/#/settings/billing?checkout=success',
        cancelUrl: 'http://localhost:1420/#/settings/billing?checkout=cancel',
      });

      await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'team' })
        .expect(200);
      // team quantity = seats used (owner + admin)
      expect(stripe.checkouts[1]).toMatchObject({ priceId: STRIPE_E2E.priceTeam, quantity: 2 });
    });

    it('refuses a second checkout while subscribed, and the portal needs a customer', async () => {
      await http().post(`${API}/billing/portal`).set(owner.bearer).expect(409);
      await dataSource.query(
        `UPDATE workspaces SET stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1',
           subscription_status = 'active', plan = 'pro' WHERE id = $1`,
        [owner.workspaceId],
      );
      const refused = await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'team' })
        .expect(409);
      expect(body(refused).message).toMatch(/portal/);

      const portal = await http().post(`${API}/billing/portal`).set(owner.bearer).expect(200);
      expect(body<{ url: string }>(portal).data.url).toBe('https://billing.stripe.test/p/cus_1');
      expect(stripe.portals[0]).toEqual({
        customerId: 'cus_1',
        returnUrl: 'http://localhost:1420/#/settings/billing',
      });

      // a canceled subscription may check out again, reusing the customer
      await dataSource.query(`UPDATE workspaces SET subscription_status = 'canceled'`);
      await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'pro' })
        .expect(200);
      expect(stripe.checkouts[0].customerId).toBe('cus_1');

      const admin = await addMemberWithRole(dataSource, owner, 'admin');
      await http().post(`${API}/billing/portal`).set(admin.bearer).expect(403);
    });
  });

  describe('POST /billing/webhook', () => {
    let seq = 0;
    const subscription = (
      overrides: Record<string, unknown> = {},
      priceId = STRIPE_E2E.pricePro,
    ) => ({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1_900_000_000,
      items: { data: [{ price: { id: priceId } }] },
      metadata: { workspaceId: owner.workspaceId },
      ...overrides,
    });
    const send = (event: object, opts: { signature?: string | null; secret?: string } = {}) => {
      const payload = JSON.stringify(event);
      const signature =
        opts.signature === undefined
          ? signer.webhooks.generateTestHeaderString({
              payload,
              secret: opts.secret ?? STRIPE_E2E.webhookSecret,
            })
          : opts.signature;
      const req = http().post(`${API}/billing/webhook`).set('Content-Type', 'application/json');
      if (signature) req.set('Stripe-Signature', signature);
      return req.send(payload);
    };
    const event = (type: string, object: unknown, id = `evt_${++seq}`, created?: number) => ({
      id,
      object: 'event',
      type,
      created: created ?? 1_800_000_000 + seq,
      data: { object },
    });
    /** What Stripe would answer to a retrieve right now. */
    const stripeHas = (overrides: Record<string, unknown> = {}, priceId = STRIPE_E2E.pricePro) => {
      const sub = subscription(overrides, priceId);
      stripe.subscriptions.set(sub.id, sub as never);
      return sub;
    };
    const completed = (id?: string) =>
      event(
        'checkout.session.completed',
        {
          mode: 'subscription',
          client_reference_id: owner.workspaceId,
          customer: 'cus_1',
          subscription: 'sub_1',
        },
        id,
      );

    it('rejects a missing or wrong signature (400) without touching anything', async () => {
      const bad = await send(completed(), { signature: null }).expect(400);
      expect(body(bad).message).toBe('The webhook signature is invalid');
      await send(completed(), { secret: 'whsec_other' }).expect(400);
      await send(completed(), { signature: 't=1,v1=deadbeef' }).expect(400);
      expect((await workspaceRow()).plan).toBe('free');
      expect(await dataSource.query('SELECT 1 FROM stripe_events')).toHaveLength(0);
    });

    it('upgrades on checkout.session.completed, audits it, and reflects it in the summary', async () => {
      stripe.subscriptions.set('sub_1', subscription() as never);
      await send(completed()).expect(200);

      expect(await workspaceRow()).toMatchObject({
        plan: 'pro',
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
        subscription_status: 'active',
        cancel_at_period_end: false,
      });
      expect((await workspaceRow()).current_period_end?.toISOString()).toBe(
        new Date(1_900_000_000 * 1000).toISOString(),
      );
      const result = await summary();
      expect(result).toMatchObject({
        plan: 'pro',
        limits: { seats: 10 },
        subscription: { status: 'active', cancelAtPeriodEnd: false },
      });
      expect(result.subscription?.currentPeriodEnd).toBe(
        new Date(1_900_000_000 * 1000).toISOString(),
      );
      const audit = (await auditActions()).filter((e) => e.action === 'billing.plan_changed');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: null,
        targetType: 'workspace',
        targetId: owner.workspaceId,
        meta: { from: 'free', to: 'pro', status: 'active' },
      });
    });

    it('applies each event id once (a retry changes nothing and audits nothing)', async () => {
      stripe.subscriptions.set('sub_1', subscription() as never);
      const first = completed('evt_same');
      await send(first).expect(200);
      await dataSource.query(`UPDATE workspaces SET plan = 'free' WHERE id = $1`, [
        owner.workspaceId,
      ]);
      await send(first).expect(200); // duplicate delivery: ignored
      expect((await workspaceRow()).plan).toBe('free');
      expect(
        await dataSource.query(`SELECT 1 FROM stripe_events WHERE id = 'evt_same'`),
      ).toHaveLength(1);
      await dataSource.query(`UPDATE workspaces SET plan = 'pro' WHERE id = $1`, [
        owner.workspaceId,
      ]);

      // parallel duplicates of a new event: one wins
      stripeHas({}, STRIPE_E2E.priceTeam);
      const dup = event('customer.subscription.updated', { id: 'sub_1' }, 'evt_par');
      await Promise.all([send(dup), send(dup), send(dup)]);
      expect((await workspaceRow()).plan).toBe('team');
      const changes = (await auditActions()).filter((e) => e.action === 'billing.plan_changed');
      expect(changes).toHaveLength(2); // free -> pro, pro -> team
    });

    it('follows subscription updates (plan from the price, status, cancel flag) and deletion', async () => {
      stripe.subscriptions.set('sub_1', subscription() as never);
      await send(completed()).expect(200);

      await send(
        event(
          'customer.subscription.updated',
          stripeHas({ cancel_at_period_end: true, status: 'past_due' }, STRIPE_E2E.priceTeam),
        ),
      ).expect(200);
      expect(await workspaceRow()).toMatchObject({
        plan: 'team',
        subscription_status: 'past_due',
        cancel_at_period_end: true,
      });

      // found through the stored subscription id, without metadata
      await send(
        event('customer.subscription.updated', stripeHas({ metadata: {} }, STRIPE_E2E.pricePro)),
      ).expect(200);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', cancel_at_period_end: false });

      await send(event('customer.subscription.deleted', stripeHas({ status: 'canceled' }))).expect(
        200,
      );
      expect(await workspaceRow()).toMatchObject({
        plan: 'free',
        subscription_status: 'canceled',
        cancel_at_period_end: false,
      });
      const actions = (await auditActions()).filter((e) => e.action === 'billing.plan_changed');
      expect(actions.map((e) => e.meta.to).reverse()).toEqual(['pro', 'team', 'pro', 'free']);
      // downgrades never delete: the workspace just cannot add more
      expect((await summary()).limits.seats).toBe(3);
    });

    it('keeps the plan of an incomplete subscription, ignores replaced subscriptions and unknown ones', async () => {
      await send(
        event('customer.subscription.created', stripeHas({ status: 'incomplete' })),
      ).expect(200);
      expect(await workspaceRow()).toMatchObject({
        plan: 'free',
        subscription_status: 'incomplete',
      });

      await send(event('customer.subscription.updated', stripeHas({ status: 'active' }))).expect(
        200,
      );
      expect((await workspaceRow()).plan).toBe('pro');

      // an old subscription ending after a new one took over must not cancel the new one
      await send(
        event('customer.subscription.deleted', stripeHas({ id: 'sub_old', status: 'canceled' })),
      ).expect(200);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_1' });

      // a subscription of nobody we know, and event types we do not handle
      await send(
        event(
          'customer.subscription.updated',
          stripeHas({ id: 'sub_x', customer: 'cus_x', metadata: {} }),
        ),
      ).expect(200);
      await send(event('invoice.paid', { id: 'in_1' })).expect(200);
      expect((await workspaceRow()).plan).toBe('pro');
    });

    it('applies the retrieved state, not the payload, and ignores late deliveries', async () => {
      stripeHas();
      await send(completed()).expect(200);
      const t = 1_800_100_000;

      // deleted (newer) applied first, then a late "updated" with a stale payload
      stripeHas({ status: 'canceled' });
      await send(event('customer.subscription.deleted', { id: 'sub_1' }, 'evt_del', t + 10)).expect(
        200,
      );
      expect(await workspaceRow()).toMatchObject({ plan: 'free', subscription_status: 'canceled' });
      stripeHas({ status: 'active' }); // a stale retrieve must not resurrect it
      await send(event('customer.subscription.updated', subscription(), 'evt_late', t + 5)).expect(
        200,
      );
      expect(await workspaceRow()).toMatchObject({ plan: 'free', subscription_status: 'canceled' });

      // the payload says "canceled" but Stripe says active: Stripe wins
      await dataSource.query(`UPDATE workspaces SET stripe_event_created = NULL`);
      stripeHas({ status: 'active' });
      await send(
        event(
          'customer.subscription.updated',
          subscription({ status: 'canceled' }),
          'evt_p',
          t + 20,
        ),
      ).expect(200);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', subscription_status: 'active' });
    });

    it('ends in the latest cancel-flag state when events arrive out of order', async () => {
      stripeHas();
      await send(completed()).expect(200);
      const t = 1_800_200_000;
      // "flag off" (newer) first, then the older "flag on"; Stripe's stale read says "on"
      stripeHas({ cancel_at_period_end: false });
      await send(event('customer.subscription.updated', { id: 'sub_1' }, 'evt_off', t + 2));
      stripeHas({ cancel_at_period_end: true });
      await send(event('customer.subscription.updated', { id: 'sub_1' }, 'evt_on', t + 1)).expect(
        200,
      );
      expect((await workspaceRow()).cancel_at_period_end).toBe(false);
      // and in the in-order case the later event wins
      await send(event('customer.subscription.updated', { id: 'sub_1' }, 'evt_on2', t + 3)).expect(
        200,
      );
      expect((await workspaceRow()).cancel_at_period_end).toBe(true);
    });

    it('applies one event delivered concurrently once', async () => {
      stripeHas();
      const dup = completed('evt_conc');
      await Promise.all([send(dup), send(dup), send(dup), send(dup)]);
      expect(
        await dataSource.query(`SELECT 1 FROM stripe_events WHERE id = 'evt_conc'`),
      ).toHaveLength(1);
      const changes = (await auditActions()).filter((e) => e.action === 'billing.plan_changed');
      expect(changes).toHaveLength(1);
      expect((await workspaceRow()).plan).toBe('pro');
    });

    it('maps unpaid and paused to the free plan (kept as past_due), past_due keeps access', async () => {
      stripeHas();
      await send(completed()).expect(200);
      stripeHas({ status: 'past_due' });
      await send(event('customer.subscription.updated', { id: 'sub_1' })).expect(200);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', subscription_status: 'past_due' });
      for (const status of ['unpaid', 'paused']) {
        stripeHas({ status: 'active' });
        await send(event('customer.subscription.updated', { id: 'sub_1' })).expect(200);
        expect((await workspaceRow()).plan).toBe('pro');
        stripeHas({ status });
        await send(event('customer.subscription.updated', { id: 'sub_1' })).expect(200);
        expect(await workspaceRow()).toMatchObject({
          plan: 'free',
          subscription_status: 'past_due',
        });
      }
      // still blocked from a new checkout: the owner fixes it in the portal
      await http()
        .post(`${API}/billing/checkout`)
        .set(owner.bearer)
        .send({ plan: 'pro' })
        .expect(409);
    });

    it('cancels a second paid subscription and audits it, keeping the first', async () => {
      stripeHas();
      await send(completed()).expect(200);
      stripeHas({ id: 'sub_2' });
      await send(event('customer.subscription.created', { id: 'sub_2' })).expect(200);
      expect(stripe.canceled).toEqual(['sub_2']);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_1' });
      const audit = (await auditActions()).filter(
        (e) => e.action === 'billing.duplicate_subscription_canceled',
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].meta).toMatchObject({ kept: 'sub_1', canceled: 'sub_2' });

      // the cancel comes back as events about a dead subscription: ignored, not canceled again
      await send(event('customer.subscription.deleted', { id: 'sub_2' })).expect(200);
      await send(
        event('checkout.session.completed', {
          mode: 'subscription',
          client_reference_id: owner.workspaceId,
          customer: 'cus_1',
          subscription: 'sub_2',
        }),
      ).expect(200);
      expect(stripe.canceled).toEqual(['sub_2']);
      expect(await workspaceRow()).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_1' });
    });

    it('needs no login and is not throttled by the auth limits', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 15; i++) {
        statuses.push((await send(event('invoice.paid', {}))).status);
      }
      expect(new Set(statuses)).toEqual(new Set([200]));
    });
  });
});

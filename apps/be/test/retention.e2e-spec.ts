import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { RetentionService } from '../src/modules/retention/retention.service';
import { createTestApp, LoggedInClient, registerAndLogin, truncateAll } from './utils';

describe('Retention (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let retention: RetentionService;
  let me: LoggedInClient;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    retention = app.get(RetentionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
  });

  const count = async (table: string): Promise<number> =>
    Number(
      ((await dataSource.query(`SELECT count(*) AS n FROM ${table}`)) as { n: string }[])[0].n,
    );
  const hash = () => randomUUID().replace(/-/g, '').repeat(2);

  it('deletes only rows past their grace period', async () => {
    const liveSessions = await count('refresh_tokens');
    const liveTokens = await count('account_tokens');
    const q = (sql: string, params: unknown[] = []) => dataSource.query(sql, params);

    await q(
      `INSERT INTO refresh_tokens (member_id, family_id, token_hash, expires_at) VALUES
        ($1, $2, $3, now() - interval '8 days'), ($1, $2, $4, now() - interval '1 day')`,
      [me.memberId, randomUUID(), hash(), hash()],
    );
    await q(
      `INSERT INTO account_tokens (member_id, kind, token_hash, expires_at, used_at) VALUES
        ($1, 'verify_email', $2, now() - interval '9 days', NULL),
        ($1, 'reset_password', $3, now() + interval '1 hour', now() - interval '8 days'),
        ($1, 'reset_password', $4, now() + interval '1 hour', NULL),
        ($1, 'verify_email', $5, now() - interval '1 day', NULL)`,
      [me.memberId, hash(), hash(), hash(), hash()],
    );
    await q(
      `INSERT INTO invites (workspace_id, email, role, token_hash, expires_at, revoked_at) VALUES
        ($1, 'old@example.com', 'member', $2, now() - interval '31 days', NULL),
        ($1, 'revoked@example.com', 'member', $3, now() + interval '1 day', now() - interval '31 days'),
        ($1, 'recent@example.com', 'member', $4, now() - interval '2 days', NULL)`,
      [me.workspaceId, hash(), hash(), hash()],
    );
    await q(
      `INSERT INTO audit_events (workspace_id, action, created_at) VALUES
        ($1, 'test.old', now() - interval '400 days'), ($1, 'test.new', now() - interval '10 days')`,
      [me.workspaceId],
    );
    await q(
      `INSERT INTO stripe_events (id, type, processed_at) VALUES
        ('evt_old', 't', now() - interval '91 days'), ('evt_new', 't', now() - interval '1 day')`,
    );

    const result = await retention.run();

    expect(result).toEqual({
      refreshTokens: 1,
      accountTokens: 2,
      pairingCodes: 0,
      invites: 2,
      auditEvents: 1,
      stripeEvents: 1,
    });
    expect(await count('refresh_tokens')).toBe(liveSessions + 1);
    expect(await count('account_tokens')).toBe(liveTokens + 2);
    expect(await count('invites')).toBe(1);
    const audit = (await q(`SELECT action FROM audit_events WHERE action LIKE 'test.%'`)) as {
      action: string;
    }[];
    expect(audit.map((row) => row.action)).toEqual(['test.new']);
    expect(await count('stripe_events')).toBe(1);

    // Idempotent.
    expect(Object.values(await retention.run()).every((n) => n === 0)).toBe(true);
  });

  it('tick() does nothing while RETENTION_ENABLED=false', async () => {
    await dataSource.query(
      `INSERT INTO audit_events (workspace_id, action, created_at)
       VALUES ($1, 'test.old', now() - interval '400 days')`,
      [me.workspaceId],
    );
    await retention.tick();
    const rows = (await dataSource.query(
      `SELECT 1 FROM audit_events WHERE action = 'test.old'`,
    )) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

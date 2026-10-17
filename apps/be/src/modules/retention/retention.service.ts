import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../../common/clock';
import { opsConfig } from '../../config';

const DAY_MS = 24 * 60 * 60 * 1000;

const TOKEN_GRACE_DAYS = 7;
const INVITE_GRACE_DAYS = 30;
const STRIPE_EVENT_DAYS = 90;

export type RetentionResult = Record<string, number>;

/**
 * Daily cleanup of rows that only ever grow: dead tokens, old invites, audit history and
 * processed Stripe events. Each step is a single DELETE and fails alone. The cron is a no-op
 * with `RETENTION_ENABLED=false` (tests); `run()` itself does not check the flag.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    @Inject(opsConfig.KEY) private readonly ops: ConfigType<typeof opsConfig>,
  ) {}

  @Cron('0 3 * * *')
  async tick(): Promise<void> {
    if (!this.ops.retentionEnabled) return;
    const result = await this.run();
    this.logger.log(`Retention removed ${JSON.stringify(result)}`);
  }

  async run(): Promise<RetentionResult> {
    const now = this.clock.now();
    const ago = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
    const tokenCutoff = ago(TOKEN_GRACE_DAYS);
    const inviteCutoff = ago(INVITE_GRACE_DAYS);

    const steps: [string, string, unknown[]][] = [
      ['refreshTokens', 'DELETE FROM refresh_tokens WHERE expires_at < $1', [tokenCutoff]],
      [
        'accountTokens',
        'DELETE FROM account_tokens WHERE expires_at < $1 OR used_at < $1',
        [tokenCutoff],
      ],
      ['pairingCodes', 'DELETE FROM pairing_codes WHERE expires_at < $1', [now]],
      [
        'invites',
        `DELETE FROM invites
          WHERE revoked_at < $1 OR (accepted_at IS NULL AND expires_at < $1)`,
        [inviteCutoff],
      ],
      [
        'auditEvents',
        'DELETE FROM audit_events WHERE created_at < $1',
        [ago(this.ops.auditRetentionDays)],
      ],
      [
        'stripeEvents',
        'DELETE FROM stripe_events WHERE processed_at < $1',
        [ago(STRIPE_EVENT_DAYS)],
      ],
    ];

    const result: RetentionResult = {};
    for (const [name, sql, params] of steps) {
      try {
        // pg returns [rows, rowCount] for DELETE through TypeORM.
        const [, count] = (await this.dataSource.query(sql, params)) as [unknown, number];
        result[name] = count;
      } catch (error) {
        result[name] = -1;
        this.logger.error(
          `Retention step ${name} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return result;
  }
}

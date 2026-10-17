import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { AuthResult, isStrongPassword, SupportedLanguage } from '@repo/shared';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { RequestMeta } from '../../common/decorators';
import { transactionWithEffects } from '../../common/utils';
import { authConfig } from '../../config';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { Member } from '../workspace/entities/member.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { toSession } from '../workspace/workspace.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import { AccountTokenService } from './account-token.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginAttemptService } from './login-attempt.service';
import { SessionService } from './session.service';
import { decideRefresh, hashToken, TokenService } from './token.service';

/** At most one reset email per address in this window; extra requests are silently dropped. */
export const FORGOT_PASSWORD_COOLDOWN_MS = 60_000;

const PG_UNIQUE_VIOLATION = '23505';
const MAX_REGISTER_ATTEMPTS = 3;

// Constraint names from the InitAuth migration (TypeORM-generated, stable).
const EMAIL_UNIQUE_CONSTRAINT = 'UQ_members_email';
const SLUG_UNIQUE_CONSTRAINT = 'UQ_workspaces_slug';

const uniqueViolationOn = (error: unknown, constraint: string): boolean => {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  return driver?.code === PG_UNIQUE_VIOLATION && driver.constraint === constraint;
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly workspaces: WorkspaceService,
    private readonly tokens: TokenService,
    private readonly accountTokens: AccountTokenService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly clock: ClockService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  private readonly logger = new Logger(AuthService.name);
  private readonly pendingMail = new Set<Promise<void>>();

  /** Verified against when the email is unknown, so both failures cost one argon2 verify. */
  private dummyHash: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('not-a-real-password', this.config.argon2);
  }

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await argon2.hash(dto.password, this.config.argon2);
    const workspaceName = dto.workspaceName?.trim() || `${dto.name} workspace`;

    for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt++) {
      try {
        const created = await this.dataSource.transaction(async (manager) => {
          const { member, workspace } = await this.workspaces.createWithOwner(manager, {
            name: dto.name,
            email: dto.email,
            passwordHash,
            workspaceName,
            termsAcceptedAt: this.clock.now(),
          });
          const verifyToken = await this.accountTokens.issue(manager, member.id, 'verify_email');
          const result = await this.buildResult(manager, member, workspace, randomUUID(), meta);
          return { result, member, verifyToken };
        });
        this.mail.sendVerifyEmail(created.member.email, created.member.name, created.verifyToken);
        return created.result;
      } catch (error) {
        if (uniqueViolationOn(error, EMAIL_UNIQUE_CONSTRAINT)) {
          throw new ConflictException({ message: 'auth.EMAIL_TAKEN' });
        }
        // Lost a race for the slug: the next attempt picks the following suffix.
        if (!uniqueViolationOn(error, SLUG_UNIQUE_CONSTRAINT)) throw error;
      }
    }
    throw new InternalServerErrorException();
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const member = await this.members
      .createQueryBuilder('member')
      .addSelect('member.passwordHash')
      .leftJoinAndSelect('member.workspace', 'workspace')
      .where('member.email = :email AND member.removedAt IS NULL', { email: dto.email })
      .getOne();

    // Always one argon2 verify (a dummy hash for an unknown email), before any answer,
    // so neither a locked nor an unknown account is told apart by timing.
    const valid = await argon2.verify(member?.passwordHash ?? this.dummyHash, dto.password);
    // Documented trade-off: an existing locked account answers 429 even for the right password.
    if (member && this.attempts.isLocked(member)) throw this.attempts.lockedError();
    if (!member || !valid) {
      if (member) await this.attempts.recordFailure(member, meta.ip);
      throw new UnauthorizedException({ message: 'auth.INVALID_CREDENTIALS' });
    }

    return this.dataSource.transaction(async (manager) => {
      await this.attempts.reset(manager, member);
      await this.audit.record(
        {
          workspaceId: member.workspaceId,
          actorMemberId: member.id,
          action: 'auth.login',
          ip: meta.ip,
        },
        manager,
      );
      return this.buildResult(manager, member, member.workspace, randomUUID(), meta);
    });
  }

  async refresh(rawToken: string, meta: RequestMeta): Promise<AuthResult> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // The row lock serialises concurrent refreshes of the same token.
      const row = await manager.findOne(RefreshToken, {
        where: { tokenHash: hashToken(rawToken) },
        lock: { mode: 'pessimistic_write' },
      });
      const decision = decideRefresh(row, new Date());
      if (!row || decision === 'invalid') return null;

      if (decision === 'reuse') {
        await this.revokeFamily(manager, row.familyId);
        return null;
      }

      row.revokedAt = new Date();
      await manager.save(row);
      const member = await manager.findOne(Member, {
        where: { id: row.memberId },
        relations: { workspace: true },
      });
      if (!member || member.removedAt) return null;
      return this.buildResult(manager, member, member.workspace, row.familyId, meta);
    });

    // Thrown after the transaction so a reuse-triggered family revocation is committed.
    if (!outcome) throw new UnauthorizedException({ message: 'auth.INVALID_REFRESH_TOKEN' });
    return outcome;
  }

  /**
   * Answers at once, whatever the address: the lookup, token and mail run in the background, so
   * a known and an unknown address cost the same. Per address at most one mail a minute.
   */
  forgotPassword(dto: ForgotPasswordDto): void {
    // The request language is read now: the background work has no request context.
    const language = this.mail.language();
    const task: Promise<void> = this.issueResetToken(dto.email, language)
      .catch((error: unknown) =>
        this.logger.error(
          'Forgot-password failed',
          error instanceof Error ? error.stack : String(error),
        ),
      )
      .finally(() => this.pendingMail.delete(task));
    this.pendingMail.add(task);
  }

  /** Resolves when every background forgot-password task has finished (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.pendingMail]);
  }

  private async issueResetToken(email: string, language: SupportedLanguage): Promise<void> {
    const member = await this.members.findOne({ where: { email, removedAt: IsNull() } });
    if (!member) return;
    const token = await this.dataSource.transaction(async (manager) => {
      // Serialises parallel requests for one member so the cooldown holds.
      await manager.query('SELECT 1 FROM members WHERE id = $1 FOR UPDATE', [member.id]);
      const last = await this.accountTokens.lastIssuedAt(manager, member.id, 'reset_password');
      if (last && this.clock.now().getTime() - last.getTime() < FORGOT_PASSWORD_COOLDOWN_MS) {
        return null;
      }
      return this.accountTokens.issue(manager, member.id, 'reset_password');
    });
    if (token) this.mail.sendResetPassword(member.email, member.name, token, language);
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    const passwordHash = await argon2.hash(dto.newPassword, this.config.argon2);
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const memberId = await this.accountTokens.consume(manager, dto.token, 'reset_password');
      const member = memberId ? await manager.findOne(Member, { where: { id: memberId } }) : null;
      if (!member || member.removedAt) throw this.invalidToken();
      // Thrown inside the transaction: a rejected password does not burn the token.
      if (!isStrongPassword(dto.newPassword, member.email)) {
        throw new BadRequestException({ message: 'auth.WEAK_PASSWORD' });
      }
      await manager.update(
        Member,
        { id: member.id },
        {
          passwordHash,
          passwordChangedAt: this.clock.now(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      );
      await this.accountTokens.invalidate(manager, member.id, 'reset_password');
      await this.sessions.revokeAll(member.id, { manager });
      await this.audit.record(
        {
          workspaceId: member.workspaceId,
          actorMemberId: member.id,
          action: 'auth.password_reset',
          ip: meta.ip,
        },
        manager,
      );
      effects.push(() => this.sessions.closeStreams(member.id));
    });
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const memberId = await this.accountTokens.consume(manager, dto.token, 'verify_email');
      if (!memberId) throw this.invalidToken();
      await manager.update(
        Member,
        { id: memberId, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: this.clock.now() },
      );
    });
  }

  private invalidToken(): BadRequestException {
    return new BadRequestException({ message: 'auth.INVALID_TOKEN' });
  }

  /** Revokes the whole family of `rawToken`; silent when the token is unknown. */
  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(RefreshToken, {
        where: { tokenHash: hashToken(rawToken) },
      });
      if (row) await this.revokeFamily(manager, row.familyId);
    });
  }

  private async revokeFamily(manager: EntityManager, familyId: string): Promise<void> {
    await manager.update(
      RefreshToken,
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async buildResult(
    manager: EntityManager,
    member: Member,
    workspace: Workspace,
    familyId: string,
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const pair = await this.tokens.issuePair(manager, member, familyId, meta);
    return { session: toSession(member, workspace), ...pair };
  }
}

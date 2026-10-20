import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuthSessionInfo, isStrongPassword, Session } from '@repo/shared';
import * as argon2 from 'argon2';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { transactionWithEffects } from '../../common/utils';
import type { AuthContext } from '../../common/types';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { authConfig } from '../../config';
import { AccountTokenService } from '../auth/account-token.service';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { SessionService } from '../auth/session.service';
import { SeatSyncService } from '../billing/seat-sync.service';
import { EventsService } from '../events';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { Member } from '../workspace/entities/member.entity';
import { toSession } from '../workspace/workspace.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import { lockRooms } from '../chat/room-access';
import { ChangePasswordDto, DeleteAccountDto, UpdateProfileDto } from './dto/account.dto';

/** At most one verification email per member in this window. */
export const VERIFY_RESEND_INTERVAL_MS = 60_000;

@Injectable()
export class AccountService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly accountTokens: AccountTokenService,
    private readonly workspaces: WorkspaceService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly seats: SeatSyncService,
    private readonly events: EventsService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async updateProfile(auth: AuthContext, dto: UpdateProfileDto): Promise<Session> {
    return transactionWithEffects(this.dataSource, async (manager, effects) => {
      const member = await this.load(manager, auth.memberId);
      const changes: Partial<Pick<Member, 'name' | 'color' | 'title'>> = {};
      if (dto.name !== undefined) changes.name = dto.name;
      if (dto.color !== undefined)
        changes.color = dto.color === null ? null : dto.color.toLowerCase();
      if (dto.title !== undefined && dto.title !== member.title) changes.title = dto.title;
      if (Object.keys(changes).length > 0) {
        const titleBefore = member.title;
        await manager.update(Member, { id: member.id }, changes);
        Object.assign(member, changes);
        await this.audit.record(
          {
            workspaceId: member.workspaceId,
            actorMemberId: member.id,
            action: 'account.profile_updated',
            targetType: 'member',
            targetId: member.id,
            meta: { fields: Object.keys(changes) },
            ip: auth.ip,
          },
          manager,
        );
        if (changes.title !== undefined) {
          await this.audit.record(
            {
              workspaceId: member.workspaceId,
              actorMemberId: member.id,
              action: 'member.title_changed',
              targetType: 'member',
              targetId: member.id,
              meta: { from: titleBefore, to: changes.title, self: true },
              ip: auth.ip,
            },
            manager,
          );
        }
        effects.push(() => this.events.publish(member.workspaceId, { type: 'members.changed' }));
      }
      return toSession(member, member.workspace);
    });
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto): Promise<void> {
    const newHash = await argon2.hash(dto.newPassword, this.config.argon2);
    // Checked outside the transaction: a wrong password is counted even though the request fails.
    const member = await this.checkPassword(auth, dto.currentPassword);
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      if (!isStrongPassword(dto.newPassword, member.email)) {
        throw new BadRequestException({ message: 'auth.WEAK_PASSWORD' });
      }
      await this.attempts.reset(manager, member);
      await manager.update(
        Member,
        { id: member.id },
        { passwordHash: newHash, passwordChangedAt: this.clock.now() },
      );
      const revoked = await this.sessions.revokeAll(member.id, {
        manager,
        ...(auth.sessionId ? { except: auth.sessionId } : {}),
      });
      await this.audit.record(
        {
          workspaceId: member.workspaceId,
          actorMemberId: member.id,
          action: 'account.password_changed',
          targetType: 'member',
          targetId: member.id,
          meta: { revokedSessions: revoked },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.sessions.closeStreams(member.id, auth.sessionId));
    });
  }

  listSessions(auth: AuthContext): Promise<AuthSessionInfo[]> {
    return this.sessions.list(auth.memberId, auth.sessionId);
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const revoked =
        isUUID(sessionId) && (await this.sessions.revoke(auth.memberId, sessionId, manager));
      if (!revoked) throw new NotFoundException({ message: 'account.SESSION_NOT_FOUND' });
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'account.sessions_revoked',
          meta: { count: 1, sessionId },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.sessions.closeSessionStreams(auth.memberId, sessionId));
    });
  }

  async revokeOtherSessions(auth: AuthContext): Promise<void> {
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      const revoked = await this.sessions.revokeAll(auth.memberId, {
        manager,
        ...(auth.sessionId ? { except: auth.sessionId } : {}),
      });
      await this.audit.record(
        {
          workspaceId: auth.workspaceId,
          actorMemberId: auth.memberId,
          action: 'account.sessions_revoked',
          meta: { count: revoked },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.sessions.closeStreams(auth.memberId, auth.sessionId));
    });
  }

  /** No-op for a verified member; otherwise a fresh token, at most one per minute. */
  async resendVerification(auth: AuthContext): Promise<void> {
    const member = await this.load(this.dataSource.manager, auth.memberId);
    if (member.emailVerifiedAt) return;
    const now = this.clock.now();
    const token = await this.dataSource.transaction(async (manager) => {
      const last = await this.accountTokens.lastIssuedAt(manager, member.id, 'verify_email');
      if (last && now.getTime() - last.getTime() < VERIFY_RESEND_INTERVAL_MS) {
        throw new HttpException(
          { message: 'account.VERIFY_RESEND_TOO_SOON' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return this.accountTokens.issue(manager, member.id, 'verify_email');
    });
    this.mail.sendVerifyEmail(member.email, member.name, token);
  }

  /** Soft-removes the caller. The owner must hand the workspace over first. */
  async deleteAccount(auth: AuthContext, dto: DeleteAccountDto): Promise<void> {
    const member = await this.checkPassword(auth, dto.password);
    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      // The rooms lock first (lock order shared with the room commands), then the workspace row.
      await lockRooms(manager, member.workspaceId);
      // Same workspace row lock as transfer-ownership: the role is re-read once it has settled,
      // so a transfer and a self-deletion can never leave the workspace without a live owner.
      await manager.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [
        member.workspaceId,
      ]);
      const current = await manager.findOne(Member, { where: { id: member.id } });
      if (!current || current.removedAt) {
        throw new NotFoundException({ message: 'account.NOT_FOUND' });
      }
      if (current.role === 'owner') {
        throw new ConflictException({ message: 'account.OWNER_MUST_TRANSFER' });
      }
      const counts = await this.workspaces.removeMember(
        manager,
        member.id,
        { scrubName: true },
        effects,
      );
      await this.audit.record(
        {
          workspaceId: member.workspaceId,
          actorMemberId: member.id,
          action: 'account.deleted',
          targetType: 'member',
          targetId: member.id,
          meta: { ...counts },
          ip: auth.ip,
        },
        manager,
      );
      effects.push(() => this.events.publish(member.workspaceId, { type: 'members.changed' }));
    });
    await this.seats.sync(member.workspaceId); // after the commit, best-effort
  }

  private async load(
    manager: EntityManager,
    memberId: string,
    withPassword = false,
  ): Promise<Member> {
    const query = manager
      .createQueryBuilder(Member, 'member')
      .leftJoinAndSelect('member.workspace', 'workspace')
      .where('member.id = :memberId AND member.removedAt IS NULL', { memberId });
    if (withPassword) query.addSelect('member.passwordHash');
    const member = await query.getOne();
    // The guard just saw this member; only a race with a removal gets here.
    if (!member) throw new NotFoundException({ message: 'account.NOT_FOUND' });
    return member;
  }

  /**
   * Verifies the caller's current password against the same counter and lockout as login: a wrong
   * password counts toward the lock (committed on its own), and a locked account is a 429. The
   * argon2 verify always runs first, so a locked caller is not told apart by timing.
   */
  async checkPassword(auth: AuthContext, password: string): Promise<Member> {
    const member = await this.load(this.dataSource.manager, auth.memberId, true);
    const valid = await argon2.verify(member.passwordHash, password);
    if (this.attempts.isLocked(member)) throw this.attempts.lockedError();
    if (!valid) {
      await this.attempts.recordFailure(member, auth.ip);
      throw new BadRequestException({ message: 'auth.WRONG_PASSWORD' });
    }
    return member;
  }
}

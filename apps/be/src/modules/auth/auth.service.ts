import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { AuthResult } from '@repo/shared';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { authConfig } from '../../config';
import { Member } from '../workspace/entities/member.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { toSession } from '../workspace/workspace.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { decideRefresh, hashToken, TokenService } from './token.service';

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
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** Verified against when the email is unknown, so both failures cost one argon2 verify. */
  private dummyHash: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('not-a-real-password', this.config.argon2);
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await argon2.hash(dto.password, this.config.argon2);
    const workspaceName = dto.workspaceName?.trim() || `${dto.name} workspace`;

    for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt++) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const { member, workspace } = await this.workspaces.createWithOwner(manager, {
            name: dto.name,
            email: dto.email,
            passwordHash,
            workspaceName,
          });
          return this.buildResult(manager, member, workspace, randomUUID());
        });
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

  async login(dto: LoginDto): Promise<AuthResult> {
    const member = await this.members
      .createQueryBuilder('member')
      .addSelect('member.passwordHash')
      .leftJoinAndSelect('member.workspace', 'workspace')
      .where('member.email = :email', { email: dto.email })
      .getOne();

    const valid = await argon2.verify(member?.passwordHash ?? this.dummyHash, dto.password);
    if (!member || !valid) {
      throw new UnauthorizedException({ message: 'auth.INVALID_CREDENTIALS' });
    }

    return this.dataSource.transaction((manager) =>
      this.buildResult(manager, member, member.workspace, randomUUID()),
    );
  }

  async refresh(rawToken: string): Promise<AuthResult> {
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
      if (!member) return null;
      return this.buildResult(manager, member, member.workspace, row.familyId);
    });

    // Thrown after the transaction so a reuse-triggered family revocation is committed.
    if (!outcome) throw new UnauthorizedException({ message: 'auth.INVALID_REFRESH_TOKEN' });
    return outcome;
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
  ): Promise<AuthResult> {
    const pair = await this.tokens.issuePair(manager, member, familyId);
    return { session: toSession(member, workspace), ...pair };
  }
}

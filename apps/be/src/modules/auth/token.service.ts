import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { AccessTokenPayload } from '../../common/guards';
import { parseDuration } from '../../common/utils';
import { authConfig } from '../../config/auth.config';
import { Member } from '../workspace/entities/member.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export type RefreshDecision = 'ok' | 'invalid' | 'reuse';

/**
 * Pure rotation rule. `null` (unknown hash) and expired tokens are plain invalid;
 * a known, unexpired token that was already revoked has been replayed, so the
 * whole family must be revoked.
 */
export const decideRefresh = (
  row: Pick<RefreshToken, 'expiresAt' | 'revokedAt'> | null,
  now: Date,
): RefreshDecision => {
  if (!row || row.expiresAt.getTime() <= now.getTime()) return 'invalid';
  if (row.revokedAt) return 'reuse';
  return 'ok';
};

/** Client of a login or refresh, kept on the refresh row for the sessions list. */
export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  signAccess(
    member: Pick<Member, 'id' | 'workspaceId' | 'role'>,
    familyId: string,
  ): Promise<string> {
    const payload = {
      sub: member.id,
      wid: member.workspaceId,
      role: member.role,
      sid: familyId,
    } satisfies AccessTokenPayload;
    return this.jwt.signAsync(payload, {
      secret: this.config.accessSecret,
      algorithm: 'HS256',
      expiresIn: Math.floor(parseDuration(this.config.accessTtl) / 1000),
    });
  }

  /** Creates and stores a refresh token in `familyId`; returns the raw token (never stored). */
  async issueRefresh(
    manager: EntityManager,
    memberId: string,
    familyId: string,
    meta: ClientMeta = { ip: null, userAgent: null },
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await manager.insert(RefreshToken, {
      memberId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + parseDuration(this.config.refreshTtl)),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return token;
  }

  async issuePair(
    manager: EntityManager,
    member: Pick<Member, 'id' | 'workspaceId' | 'role'>,
    familyId: string,
    meta?: ClientMeta,
  ): Promise<TokenPair> {
    return {
      accessToken: await this.signAccess(member, familyId),
      refreshToken: await this.issueRefresh(manager, member.id, familyId, meta),
    };
  }
}

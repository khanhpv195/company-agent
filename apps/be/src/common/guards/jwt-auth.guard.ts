import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { MemberRole } from '@repo/shared';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { authConfig } from '../../config/auth.config';
import { IS_PUBLIC_KEY } from '../../contacts';
import { AuthContext } from '../types';

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  role: MemberRole;
  /** Refresh family of the login this token was issued for; the session it belongs to. */
  sid: string;
  exp?: number;
}

interface MemberRow {
  workspace_id: string;
  role: MemberRole;
  removed_at: Date | null;
  /** The `sid` family still has an unrevoked, unexpired refresh token. */
  session_live: boolean;
}

const ROLES: readonly string[] = ['owner', 'admin', 'member'];

/**
 * Bearer-JWT guard, registered globally. Use `@Public()` to opt out. The token proves who is
 * calling; the member row decides whether they still may: a removed or deleted member, or one
 * whose workspace differs from the token, is a 401, and the role used for authorization is the
 * one in the database, so role changes apply at once. The same query checks (EXISTS) that the
 * token's session (`sid`, the refresh family) is still live, so logout, revoking a session,
 * a password change or reset and removing the member end their access tokens immediately.
 * A token without a `sid` is rejected.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
    @InjectDataSource() private readonly dataSource: Pick<DataSource, 'query'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw this.unauthorized();

    let payload: Partial<AccessTokenPayload>;
    try {
      payload = await this.jwt.verifyAsync<Partial<AccessTokenPayload>>(token, {
        secret: this.config.accessSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw this.unauthorized();
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.wid !== 'string' ||
      typeof payload.role !== 'string' ||
      !ROLES.includes(payload.role) ||
      typeof payload.sid !== 'string' ||
      !isUUID(payload.sub) ||
      !isUUID(payload.sid)
    ) {
      throw this.unauthorized();
    }

    const rows = await this.dataSource.query<MemberRow[]>(
      `SELECT m.workspace_id, m.role, m.removed_at,
              EXISTS (SELECT 1 FROM refresh_tokens t
                      WHERE t.member_id = m.id AND t.family_id = $2::uuid
                        AND t.revoked_at IS NULL AND t.expires_at > now()) AS session_live
       FROM members m WHERE m.id = $1`,
      [payload.sub, payload.sid],
    );
    const member = rows[0];
    if (
      !member ||
      member.removed_at !== null ||
      member.workspace_id !== payload.wid ||
      !member.session_live ||
      !ROLES.includes(member.role)
    ) {
      throw this.unauthorized();
    }

    const auth: AuthContext = {
      memberId: payload.sub,
      workspaceId: member.workspace_id,
      role: member.role,
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
      sessionId: payload.sid,
      ...(request.ip ? { ip: request.ip } : {}),
    };
    request.auth = auth;
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
  }
}

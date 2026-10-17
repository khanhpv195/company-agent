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
import { MemberRole } from '@repo/shared';
import type { Request } from 'express';
import { authConfig } from '../../config/auth.config';
import { IS_PUBLIC_KEY } from '../../contacts';
import { AuthContext } from '../types';

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  role: MemberRole;
  exp?: number;
}

const ROLES: readonly string[] = ['owner', 'admin', 'member'];

/** Stateless bearer-JWT guard, registered globally. Use `@Public()` to opt out. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
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
      !ROLES.includes(payload.role)
    ) {
      throw this.unauthorized();
    }

    const auth: AuthContext = {
      memberId: payload.sub,
      workspaceId: payload.wid,
      role: payload.role,
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
    };
    request.auth = auth;
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
  }
}

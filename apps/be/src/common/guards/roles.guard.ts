import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole } from '@repo/shared';
import type { Request } from 'express';
import { ROLES_KEY } from '../../contacts';

/** Global, registered after `JwtAuthGuard`: enforces `@Roles(...)` against `req.auth.role`. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
    if (!roles.includes(auth.role)) throw new ForbiddenException({ message: 'auth.FORBIDDEN' });
    return true;
  }
}

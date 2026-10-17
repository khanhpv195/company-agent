import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthContext } from '../types';

/** Injects `req.auth` (set by `JwtAuthGuard`) into a handler parameter. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw new UnauthorizedException({ message: 'auth.UNAUTHORIZED' });
  return auth satisfies AuthContext;
});

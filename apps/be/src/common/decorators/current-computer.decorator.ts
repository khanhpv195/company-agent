import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ComputerContext } from '../types';

/** Injects `req.computer` (set by `ComputerAuthGuard`) into a handler parameter. */
export const CurrentComputer = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const computer = ctx.switchToHttp().getRequest<Request>().computer;
  if (!computer) throw new UnauthorizedException({ message: 'gateway.INVALID_API_KEY' });
  return computer satisfies ComputerContext;
});

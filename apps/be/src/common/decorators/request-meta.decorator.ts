import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Who is calling: the client address and user agent, for sessions and the audit log. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const requestMetaOf = (request: Request): RequestMeta => {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 256) : null,
  };
};

export const ReqMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMetaOf(ctx.switchToHttp().getRequest<Request>()),
);

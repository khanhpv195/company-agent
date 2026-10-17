import { ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { API_PREFIX } from '../../contacts';
import { AuthThrottlerGuard, THROTTLER_API, THROTTLER_GATEWAY } from './auth-throttler.guard';

/** Never throttled: the live stream, probes and Stripe's webhook (Stripe retries are legitimate). */
const SKIPPED_PATH = new RegExp(`^/${API_PREFIX}/v\\d+/(events|health|billing/webhook)(/|$)`);
const GATEWAY_PATH = new RegExp(`^/${API_PREFIX}/v\\d+/gateway(/|$)`);

const pathOf = (context: ExecutionContext): string =>
  (context.switchToHttp().getRequest<Request>().originalUrl ?? '').split('?')[0];

/** One bucket per tracker for the whole API, not one per route. */
const sharedKey = (_context: ExecutionContext, tracker: string, name: string): string =>
  `${name}:${tracker}`;

/**
 * Global limit for every JWT route (`API_THROTTLE_LIMIT` per minute), keyed by member id and by
 * address for public routes. Registered as `APP_GUARD` after `JwtAuthGuard`, so `req.auth` is set.
 * Gateway routes are limited per computer by `GatewayThrottlerGuard` instead.
 */
@Injectable()
export class ApiThrottlerGuard extends AuthThrottlerGuard {
  protected override readonly throttlerName = THROTTLER_API;

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const path = pathOf(context);
    return SKIPPED_PATH.test(path) || GATEWAY_PATH.test(path);
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = req.auth as { memberId?: string } | undefined;
    return Promise.resolve(auth?.memberId ? `member:${auth.memberId}` : `ip:${String(req.ip)}`);
  }

  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    return sharedKey(context, tracker, name);
  }
}

/** Daemon routes: `GATEWAY_THROTTLE_LIMIT` per minute and computer. Used after `ComputerAuthGuard`. */
@Injectable()
export class GatewayThrottlerGuard extends AuthThrottlerGuard {
  protected override readonly throttlerName = THROTTLER_GATEWAY;

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const computer = req.computer as { id?: string } | undefined;
    return Promise.resolve(computer?.id ? `computer:${computer.id}` : `ip:${String(req.ip)}`);
  }

  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    return sharedKey(context, tracker, name);
  }
}

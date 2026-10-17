import { Injectable } from '@nestjs/common';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/**
 * Throttles authenticated routes per member instead of per address. Runs after the global
 * `JwtAuthGuard`, so `req.auth` is set; the address is only the fallback.
 */
@Injectable()
export class MemberThrottlerGuard extends AuthThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = req.auth as { memberId?: string } | undefined;
    return Promise.resolve(auth?.memberId ?? String(req.ip));
  }
}

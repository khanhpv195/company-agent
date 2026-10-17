import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerRequest,
} from '@nestjs/throttler';

/** Names of the throttlers registered in `ThrottlerModule` (see `app.module.ts`). */
export const THROTTLER_AUTH = 'default';
export const THROTTLER_API = 'api';
export const THROTTLER_GATEWAY = 'gateway';

/**
 * ThrottlerGuard that fails with the standard i18n error envelope. Several throttlers are
 * registered, so each guard only applies its own (`throttlerName`).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected readonly throttlerName: string = THROTTLER_AUTH;

  protected override handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name !== this.throttlerName) return Promise.resolve(true);
    return super.handleRequest(props);
  }

  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The library suffixes the header of named throttlers (`Retry-After-api`): clients read the plain one.
    const { res } = this.getRequestResponse(context);
    this.setResponseHeader(res, 'Retry-After', detail.timeToBlockExpire);
    throw new HttpException(
      { message: 'common.errors.TOO_MANY_REQUESTS' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

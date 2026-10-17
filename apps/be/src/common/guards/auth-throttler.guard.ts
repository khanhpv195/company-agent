import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** ThrottlerGuard that fails with the standard i18n error envelope. */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new HttpException(
      { message: 'common.errors.TOO_MANY_REQUESTS' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

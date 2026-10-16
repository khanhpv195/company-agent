import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiResponse } from '@repo/shared';
import { I18nContext } from 'nestjs-i18n';
import { map, Observable } from 'rxjs';
import { DEFAULT_SUCCESS_MESSAGE, RAW_RESPONSE_KEY, RESPONSE_MESSAGE_KEY } from '../../contacts';
import { PaginatedResult } from '../dto/response.dto';
import { translate } from '../utils';

@Injectable()
export class TransformResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, targets)) {
      return next.handle();
    }

    const messageKey =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, targets) ??
      DEFAULT_SUCCESS_MESSAGE;

    return next.handle().pipe(
      map((body: unknown): ApiResponse => {
        const message = translate(I18nContext.current(context), messageKey);

        if (body instanceof PaginatedResult) {
          return { success: true, data: body.items, message, meta: { ...body.meta } };
        }
        return { success: true, data: body ?? null, message };
      }),
    );
  }
}

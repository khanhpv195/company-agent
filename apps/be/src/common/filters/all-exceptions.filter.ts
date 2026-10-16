import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ApiErrorResponse, ApiFieldError } from '@repo/shared';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { flattenValidationErrors, translate, translateValidationMessage } from '../utils';

interface HttpExceptionBody {
  message?: string | string[];
  args?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const i18n = I18nContext.current(host);

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string;
    let errors: ApiFieldError[] | undefined;

    if (exception instanceof I18nValidationException) {
      errors = exception.errorsAlreadyTranslated
        ? flattenValidationErrors(exception.errors)
        : flattenValidationErrors(exception.errors, (raw, error) =>
            translateValidationMessage(i18n, raw, error.property),
          );
      message = translate(i18n, 'common.errors.VALIDATION_FAILED');
    } else if (exception instanceof HttpException) {
      const { key, args } = this.extractMessage(exception);
      message = translate(i18n, key, args);
    } else {
      message = translate(i18n, 'common.errors.INTERNAL_SERVER_ERROR');
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      data: null,
      message,
      meta: {
        statusCode: status,
        path: httpAdapter.getRequestUrl(ctx.getRequest()) as string,
        timestamp: new Date().toISOString(),
        ...(errors && { errors }),
      },
    };

    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private extractMessage(exception: HttpException): {
    key: string;
    args?: Record<string, unknown>;
  } {
    const response = exception.getResponse();
    if (typeof response === 'string') return { key: response };

    const { message, args } = response as HttpExceptionBody;
    if (Array.isArray(message)) return { key: message.join('; '), args };
    return { key: message ?? exception.message, args };
  }
}

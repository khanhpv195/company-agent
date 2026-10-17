import { isStrongPassword } from '@repo/shared';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

/**
 * Applies the shared password policy. When the DTO has an `email` field the password may not
 * equal it; DTOs without one (reset, change) re-check against the member's email in the service.
 */
export const IsStrongPassword =
  (options?: ValidationOptions) =>
  (object: object, propertyName: string): void =>
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: { message: i18nValidationMessage('validation.WEAK_PASSWORD'), ...options },
      validator: {
        validate(value: unknown, args): boolean {
          if (typeof value !== 'string') return false;
          const email = (args?.object as { email?: unknown } | undefined)?.email;
          return isStrongPassword(value, typeof email === 'string' ? email : undefined);
        },
      },
    });

import { ApiFieldError } from '@repo/shared';
import { ValidationError } from 'class-validator';

type MessageMapper = (message: string, error: ValidationError) => string;

export const flattenValidationErrors = (
  errors: ValidationError[],
  mapMessage: MessageMapper = (message) => message,
  parentPath = '',
): ApiFieldError[] =>
  errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own: ApiFieldError[] = error.constraints
      ? [
          {
            field,
            messages: Object.values(error.constraints).map((message) => mapMessage(message, error)),
          },
        ]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], mapMessage, field)];
  });

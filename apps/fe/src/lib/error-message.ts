import type { MessageKey, TFunction } from '../i18n';
import { ApiError } from './api-client';

/**
 * User-facing text for a failed request. A 429 shows the server's message when it has one,
 * otherwise the generic "too many attempts" text. Other API errors show their message, and
 * anything else (or an empty message) falls back to `fallback`.
 */
export function errorMessage(err: unknown, t: TFunction, fallback: MessageKey): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return err.message || t('common.tooManyAttempts');
    if (err.message) return err.message;
  }
  return t(fallback);
}

import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from '../i18n';
import { ApiError } from './api-client';
import { errorMessage } from './error-message';

const t = vi.fn((key: string) => `t:${key}`) as unknown as TFunction;
const FALLBACK = 'auth.forgot.failed' as const;

describe('errorMessage', () => {
  it('prefers the server message for 429 when it is non-empty', () => {
    expect(errorMessage(new ApiError('Slow down', 429), t, FALLBACK)).toBe('Slow down');
  });

  it('uses the too-many-attempts key for 429 without a server message', () => {
    expect(errorMessage(new ApiError('', 429), t, FALLBACK)).toBe('t:common.tooManyAttempts');
  });

  it('shows the server message for other API errors', () => {
    expect(errorMessage(new ApiError('Bad input', 400), t, FALLBACK)).toBe('Bad input');
  });

  it('falls back to the given key for empty messages and non-API errors', () => {
    expect(errorMessage(new ApiError('', 500), t, FALLBACK)).toBe(`t:${FALLBACK}`);
    expect(errorMessage(new Error('boom'), t, FALLBACK)).toBe(`t:${FALLBACK}`);
  });
});

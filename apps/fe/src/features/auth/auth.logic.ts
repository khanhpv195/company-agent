import { isStrongPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@repo/shared';

/** i18n key suffixes under `auth.password.*` / form errors. `null` means the value is fine. */
export type PasswordIssue = 'tooShort' | 'tooLong' | 'needLetterDigit' | 'sameAsEmail';

/**
 * Client-side mirror of the API password policy (shared `isStrongPassword`). Returns the first
 * problem so the UI can show a specific hint; an empty password is not flagged (the field is
 * simply required).
 */
export function passwordIssue(password: string, email?: string): PasswordIssue | null {
  if (!password) return null;
  if (password.length < PASSWORD_MIN_LENGTH) return 'tooShort';
  if (password.length > PASSWORD_MAX_LENGTH) return 'tooLong';
  if (isStrongPassword(password, email)) return null;
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) return 'sameAsEmail';
  return 'needLetterDigit';
}

export const isPasswordOk = (password: string, email?: string): boolean =>
  password.length > 0 && isStrongPassword(password, email);

/** Trims a pasted code and drops inner whitespace/newlines that mail clients add when wrapping. */
export const cleanToken = (raw: string): string => raw.replace(/\s+/g, '');

const EMAIL_RE = /^\S+@\S+\.\S+$/;
export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

/** http(s) links only: guards the env-provided legal URLs against `javascript:` and typos. */
export const safeLegalUrl = (value: string | undefined): string | null => {
  const v = value?.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Password policy for register, reset and change: 8..128 characters, at least one letter and
 * one digit, and not equal to the account email (compared case-insensitively, trimmed).
 * Login never applies it, so accounts created under an older policy can still sign in.
 */
export const isStrongPassword = (password: string, email?: string): boolean => {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return false;
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return false;
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) return false;
  return true;
};

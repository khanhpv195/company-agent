/** Removes ASCII/Unicode control characters (C0, DEL, C1) such as NUL, newlines and escapes. */
export const stripControlChars = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

/**
 * `@Transform` for display names (member, workspace): drops control characters, then trims.
 * Non-strings pass through so the type validators report them.
 */
export const cleanName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? stripControlChars(value).trim() : value;

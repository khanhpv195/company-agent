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

/** Whitespace runs (newlines, tabs) become one space, then remaining control characters go. */
const collapseText = (value: string): string =>
  stripControlChars(value.replace(/\s+/g, ' ')).replace(/ {2,}/g, ' ').trim();

/** `@Transform` for department names: like `cleanName`, and runs of whitespace become one space. */
export const cleanDepartmentName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? collapseText(value) : value;

/** `@Transform` for job titles: like `cleanName`, and an empty title becomes `null` (cleared). */
export const cleanTitle = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? collapseText(value) || null : value;

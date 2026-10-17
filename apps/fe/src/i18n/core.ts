/**
 * Pure i18n core (no React, no store): message lookup, `{var}` interpolation and plurals.
 * Messages are nested objects; a leaf is a string or a plural object `{ one, other }`.
 */

export type Locale = 'vi' | 'en';
export const LOCALES: readonly Locale[] = ['vi', 'en'];

export interface PluralMessage {
  one: string;
  other: string;
}
export type Vars = Record<string, string | number>;

/** Widens `as const` literals so another language can supply different strings. */
export type Widen<T> = T extends string
  ? string
  : T extends { readonly other: string }
    ? PluralMessage
    : { -readonly [K in keyof T]: Widen<T[K]> };

type Leaf = string | { readonly other: string };

/** "a.b.c" paths of every leaf. */
export type KeyPath<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : KeyPath<T[K], `${P}${K}.`>;
}[keyof T & string];

const lookup = (messages: unknown, key: string): unknown => {
  let node = messages;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
};

const interpolate = (text: string, vars?: Vars): string =>
  vars
    ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in vars ? String(vars[name]) : whole,
      )
    : text;

/**
 * Resolves `key` in `messages`. Plural leaves pick `one`/`other` by `Intl.PluralRules(locale)`
 * from `vars.n`. A missing key falls back to the fallback catalog, then to the key itself.
 */
export function translateWith(
  locale: Locale,
  messages: unknown,
  fallback: unknown,
  key: string,
  vars?: Vars,
): string {
  const found = lookup(messages, key) ?? lookup(fallback, key);
  if (typeof found === 'string') return interpolate(found, vars);
  if (found && typeof found === 'object' && 'other' in found) {
    const plural = found as PluralMessage;
    const n = Number(vars?.n ?? 0);
    const category = new Intl.PluralRules(locale).select(n);
    return interpolate(category === 'one' ? plural.one : plural.other, vars);
  }
  return key;
}

/** Deep list of dotted leaf keys, used by the parity test. */
export function leafKeys(messages: unknown, prefix = ''): string[] {
  if (messages === null || typeof messages !== 'object') return [];
  const entries = Object.entries(messages as Record<string, unknown>);
  return entries.flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') return [path];
    if (v && typeof v === 'object' && 'other' in v) return [path];
    return leafKeys(v, path);
  });
}

/** vi unless the browser language starts with "en"; a stored valid choice always wins. */
export function detectLocale(
  stored: string | null | undefined,
  navigatorLanguage?: string,
): Locale {
  if (stored === 'vi' || stored === 'en') return stored;
  return navigatorLanguage?.toLowerCase().startsWith('en') ? 'en' : 'vi';
}

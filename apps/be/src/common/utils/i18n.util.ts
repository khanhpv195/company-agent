import { I18nContext } from 'nestjs-i18n';

const I18N_KEY_PATTERN = /^[\w-]+(\.[\w-]+)+$/;

export const isI18nKey = (value: string): boolean => I18N_KEY_PATTERN.test(value);

/** Translates `key` when an i18n context is available, otherwise returns the key unchanged. */
export const translate = (
  i18n: I18nContext | undefined,
  key: string,
  args?: Record<string, unknown>,
): string => {
  if (!i18n || !isI18nKey(key)) return key;
  return i18n.t(key, { args });
};

/**
 * Translates a message produced by `i18nValidationMessage()` (`"<key>|<json args>"`).
 * Plain class-validator messages are returned unchanged.
 */
export const translateValidationMessage = (
  i18n: I18nContext | undefined,
  rawMessage: string,
  property: string,
): string => {
  const separatorIndex = rawMessage.indexOf('|');
  const key = separatorIndex === -1 ? rawMessage : rawMessage.slice(0, separatorIndex);

  let args: Record<string, unknown> = {};
  if (separatorIndex !== -1) {
    try {
      args = JSON.parse(rawMessage.slice(separatorIndex + 1)) as Record<string, unknown>;
    } catch {
      args = {};
    }
  }

  const constraints = Array.isArray(args.constraints)
    ? Object.fromEntries(args.constraints.map((value: unknown, index) => [String(index), value]))
    : undefined;

  return translate(i18n, key, { property, ...args, ...(constraints && { constraints }) });
};

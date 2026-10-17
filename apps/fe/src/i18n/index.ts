import { useCallback } from 'react';
import { translateWith, type KeyPath, type Locale, type Vars } from './core';
import { getLocale, useLocaleStore } from './locale-store';
import { en } from './messages/en';
import { vi, type ViMessages } from './messages/vi';

export type MessageKey = KeyPath<ViMessages>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

const catalogs: Record<Locale, unknown> = { vi, en };

/** Translate outside React (uses the current language). Prefer `useT()` in components. */
export const translate: TFunction = (key, vars) =>
  translateWith(getLocale(), catalogs[getLocale()], vi, key, vars);

/** `t('tasks.count', { n: 3 })`; re-renders the component when the language changes. */
export function useT(): TFunction {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback<TFunction>(
    (key, vars) => translateWith(locale, catalogs[locale], vi, key, vars),
    [locale],
  );
}

export const useLocale = (): Locale => useLocaleStore((s) => s.locale);

export { LOCALES, detectLocale, leafKeys, translateWith, type Locale, type Vars } from './core';
export { getLocale, setLanguage, useLocaleStore } from './locale-store';
export * from './format';

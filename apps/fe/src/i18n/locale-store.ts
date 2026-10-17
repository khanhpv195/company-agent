import { create } from 'zustand';
import { detectLocale, type Locale } from './core';

const KEY = 'agent.lang';

const readStored = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const applyToDocument = (locale: Locale) => {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
};

interface LocaleState {
  locale: Locale;
  setLanguage: (locale: Locale) => void;
}

const initial = detectLocale(
  readStored(),
  typeof navigator === 'undefined' ? undefined : navigator.language,
);
applyToDocument(initial);

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: initial,
  setLanguage: (locale) => {
    try {
      localStorage.setItem(KEY, locale);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
    applyToDocument(locale);
    set({ locale });
  },
}));

/** Non-hook access for code outside React (api client, query cache, stores). */
export const getLocale = (): Locale => useLocaleStore.getState().locale;
export const setLanguage = (locale: Locale): void => useLocaleStore.getState().setLanguage(locale);

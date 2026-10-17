import { create } from 'zustand';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'agent.theme';

const isSetting = (v: unknown): v is ThemeSetting =>
  v === 'system' || v === 'light' || v === 'dark';

const readStored = (): ThemeSetting => {
  try {
    const v = localStorage.getItem(KEY);
    return isSetting(v) ? v : 'system';
  } catch {
    return 'system';
  }
};

const systemDark = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export const resolveTheme = (setting: ThemeSetting, prefersDark: boolean): ResolvedTheme =>
  setting === 'system' ? (prefersDark ? 'dark' : 'light') : setting;

/** Writes the resolved theme to <html data-theme>; app.css keys all dark variables off it. */
const apply = (setting: ThemeSetting): ResolvedTheme => {
  const resolved = resolveTheme(setting, systemDark()?.matches ?? false);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = resolved;
  return resolved;
};

interface ThemeState {
  theme: ThemeSetting;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemeSetting) => void;
}

const initial = readStored();

export const useTheme = create<ThemeState>()((set) => ({
  theme: initial,
  resolved: apply(initial),
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
    set({ theme, resolved: apply(theme) });
  },
}));

// "System" follows the OS live.
systemDark()?.addEventListener('change', () => {
  const { theme } = useTheme.getState();
  if (theme === 'system') useTheme.setState({ resolved: apply('system') });
});

export const setTheme = (theme: ThemeSetting): void => useTheme.getState().setTheme(theme);

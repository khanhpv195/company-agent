import { setLanguage, useLocale, useT, type Locale } from '../../i18n';
import { setTheme, useTheme, type ThemeSetting } from '../../stores/theme';

export function AppearanceSection() {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme((s) => s.theme);
  const languages: [Locale, string][] = [
    ['vi', t('settings.appearance.langVi')],
    ['en', t('settings.appearance.langEn')],
  ];
  const themes: [ThemeSetting, string][] = [
    ['system', t('settings.appearance.themeSystem')],
    ['light', t('settings.appearance.themeLight')],
    ['dark', t('settings.appearance.themeDark')],
  ];
  return (
    <div className="box set-box">
      <h4 id="ap-lang">{t('settings.appearance.language')}</h4>
      <div className="seg" role="group" aria-labelledby="ap-lang" style={{ width: 'fit-content' }}>
        {languages.map(([id, label]) => (
          <button
            key={id}
            className={locale === id ? 'on' : ''}
            aria-pressed={locale === id}
            onClick={() => setLanguage(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <h4 id="ap-theme" style={{ marginTop: 20 }}>
        {t('settings.appearance.theme')}
      </h4>
      <div className="seg" role="group" aria-labelledby="ap-theme" style={{ width: 'fit-content' }}>
        {themes.map(([id, label]) => (
          <button
            key={id}
            className={theme === id ? 'on' : ''}
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

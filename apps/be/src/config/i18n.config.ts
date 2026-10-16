import { ConfigType, registerAs } from '@nestjs/config';
import { SupportedLanguage } from '@repo/shared';

export const i18nConfig = registerAs('i18n', () => ({
  fallbackLanguage: (process.env.FALLBACK_LANGUAGE as SupportedLanguage) ?? SupportedLanguage.EN,
}));

export type I18nConfig = ConfigType<typeof i18nConfig>;

import { safeLegalUrl } from './auth.logic';

/** Optional public legal pages; the register form shows plain text when unset. */
export const TERMS_URL = safeLegalUrl(import.meta.env.VITE_TERMS_URL);
export const PRIVACY_URL = safeLegalUrl(import.meta.env.VITE_PRIVACY_URL);

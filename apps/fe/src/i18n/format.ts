import { getLocale } from './locale-store';

const tag = () => (getLocale() === 'vi' ? 'vi-VN' : 'en-US');

type Time = number | string | Date;
const toDate = (t: Time) => (t instanceof Date ? t : new Date(t));

/** Locale-aware wrappers over `Intl`; they read the current language at call time. */
export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(tag(), opts).format(n);

export const formatDate = (t: Time, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
  new Intl.DateTimeFormat(tag(), opts).format(toDate(t));

export const formatTime = (t: Time) => formatDate(t, { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (t: Time) =>
  formatDate(t, { dateStyle: 'medium', timeStyle: 'short' });

/** "3 phút trước" / "3 minutes ago" from an elapsed number of seconds (positive = past). */
export function formatRelativeSeconds(seconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(tag(), { numeric: 'auto' });
  const abs = Math.abs(seconds);
  const sign = seconds >= 0 ? -1 : 1;
  if (abs < 60) return rtf.format(sign * Math.round(abs), 'second');
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  return rtf.format(sign * Math.round(abs / 86400), 'day');
}

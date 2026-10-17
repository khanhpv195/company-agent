import { formatTime, translate } from '../i18n';

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const ms = (iso: string) => Date.parse(iso);

/** 1:05 — elapsed timer. */
export const mmss = (elapsedMs: number) => {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "3 phút trước" / "3 min ago". */
export function rel(iso: string, now: number) {
  const s = Math.round((now - ms(iso)) / 1000);
  if (s < 45) return translate('time.justNow');
  if (s < 3600) return translate('time.minutesAgo', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86400) return translate('time.hoursAgo', { n: Math.round(s / 3600) });
  return translate('time.daysAgo', { n: Math.round(s / 86400) });
}

/** Heartbeat age: "2s trước". */
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - ms(iso)) / 1000));
  if (s < 60) return translate('time.secondsAgoShort', { n: s });
  if (s < 3600) return translate('time.minutesAgo', { n: Math.floor(s / 60) });
  return translate('time.hoursAgo', { n: Math.floor(s / 3600) });
}

/** Short relative time for lists: "23h", "2d". */
export function short(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - ms(iso)) / 1000));
  if (s < 60) return translate('time.now');
  if (s < 3600) return translate('time.minutesShort', { n: Math.floor(s / 60) });
  if (s < 86400) return translate('time.hoursShort', { n: Math.floor(s / 3600) });
  return translate('time.daysShort', { n: Math.floor(s / 86400) });
}

/** 1m 05s / 2h 10m. */
export const dur = (sec: number) =>
  sec < 60
    ? `${sec}s`
    : sec < 3600
      ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`
      : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;

export const hhmm = (t: number) => formatTime(t);

/** "$0.012" for a run cost reported by a real daemon; small amounts keep three decimals. */
export const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

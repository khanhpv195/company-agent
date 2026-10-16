export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const ms = (iso: string) => Date.parse(iso);

/** 1:05 — elapsed timer. */
export const mmss = (elapsedMs: number) => {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "3 phút trước". */
export function rel(iso: string, now: number) {
  const s = Math.round((now - ms(iso)) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

/** Heartbeat age: "2s trước". */
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - ms(iso)) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  return `${Math.floor(s / 3600)} giờ trước`;
}

/** Short relative time for lists: "23h", "2d". */
export function short(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - ms(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** 1m 05s / 2h 10m. */
export const dur = (sec: number) =>
  sec < 60
    ? `${sec}s`
    : sec < 3600
      ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`
      : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;

export const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

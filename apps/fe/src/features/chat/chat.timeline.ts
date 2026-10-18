import type { Message } from '@repo/shared';
import type { LocalMessage } from '../../stores/chat';

/** Same author within this window share one header (avatar, name, time). */
export const GROUP_WINDOW_MS = 5 * 60_000;

export type TimelineRow =
  | { type: 'day'; key: string; at: string }
  | { type: 'new'; count: number }
  | { type: 'msg'; message: LocalMessage; grouped: boolean };

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day, `YYYY-MM-DD`. */
export function dayKey(at: number | string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar days from `at` to `now` in local time: 0 = today, 1 = yesterday, negative = future. */
export function dayDiff(at: number | string, now: number): number {
  const a = new Date(at);
  const b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86_400_000);
}

export function sameAuthor(a: Message['author'], b: Message['author']): boolean {
  if (a.kind === 'external' || b.kind === 'external') return false;
  return a.kind === b.kind && a.id === b.id;
}

/** Whether `m` continues the group of `prev` (never across days or after a long pause). */
export function continuesGroup(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.deleted || m.deleted) return false;
  if (!sameAuthor(prev.author, m.author)) return false;
  const gap = Date.parse(m.createdAt) - Date.parse(prev.createdAt);
  if (gap < 0 || gap > GROUP_WINDOW_MS) return false;
  return dayKey(prev.createdAt) === dayKey(m.createdAt);
}

export interface BuildOptions {
  /** The caller's read cursor when the room was opened; null disables the "new messages" divider. */
  lastReadSeq: number | null;
  /** Member id of the caller: their own messages never count as new. */
  me?: string;
}

/** Messages (oldest first) to rows with day dividers, the "N new messages" divider and groups. */
export function buildTimeline(messages: LocalMessage[], opts: BuildOptions): TimelineRow[] {
  const isNew = (m: LocalMessage) =>
    opts.lastReadSeq !== null &&
    !m.local &&
    !m.deleted &&
    m.seq !== undefined &&
    m.seq > opts.lastReadSeq &&
    !(m.author.kind === 'human' && m.author.id === opts.me);
  const firstNew = messages.findIndex(isNew);
  const newCount = firstNew < 0 ? 0 : messages.slice(firstNew).filter(isNew).length;

  const rows: TimelineRow[] = [];
  let prev: LocalMessage | undefined;
  messages.forEach((m, i) => {
    const key = dayKey(m.createdAt);
    const newDay = !prev || dayKey(prev.createdAt) !== key;
    if (newDay) rows.push({ type: 'day', key, at: m.createdAt });
    const divider = i === firstNew && newCount > 0;
    if (divider) rows.push({ type: 'new', count: newCount });
    rows.push({
      type: 'msg',
      message: m,
      grouped: !newDay && !divider && continuesGroup(prev, m),
    });
    prev = m;
  });
  return rows;
}

/** Highest seq among server messages (outbox items have none). */
export function maxSeq(messages: Message[]): number {
  let max = 0;
  for (const m of messages) if (m.seq !== undefined && m.seq > max) max = m.seq;
  return max;
}

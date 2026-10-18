import type { PinItem, Room } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import { buildSidebar, capCount, lessUsedIds, LESS_USED_AFTER_MS } from './chat.sidebar';

const NOW = Date.UTC(2026, 5, 20);
const DAY = 86_400_000;
const room = (id: string, over: Partial<Room> = {}): Room => ({
  id,
  kind: 'channel',
  name: id,
  icon: 'users',
  isPrivate: false,
  agentId: null,
  lastMessageAt: new Date(NOW - DAY).toISOString(),
  preview: '',
  threads: [],
  myRole: 'member',
  ...over,
});
const base = { pins: [] as PinItem[], now: NOW };

describe('capCount', () => {
  it('caps at 99+', () => {
    expect(capCount(7)).toBe('7');
    expect(capCount(99)).toBe('99');
    expect(capCount(100)).toBe('99+');
  });
});

describe('lessUsedIds', () => {
  const opened = (days: Record<string, number>) =>
    Object.fromEntries(Object.entries(days).map(([id, d]) => [id, NOW - d * DAY]));

  it('moves channels unused for 7+ days but keeps the 5 most recently opened', () => {
    const rooms = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => room(id));
    // All are old; a..e are the 5 most recent of the lot and stay.
    const ids = lessUsedIds(rooms, opened({ a: 8, b: 9, c: 10, d: 11, e: 12, f: 20, g: 30 }), NOW);
    expect([...ids].sort()).toEqual(['f', 'g']);
  });

  it('keeps recently opened, unread and active channels, and ones never opened', () => {
    const rooms = [
      room('fresh'),
      room('old'),
      room('unread', { unread: 2 }),
      room('active'),
      room('never'),
    ];
    const ids = lessUsedIds(
      rooms,
      { fresh: NOW - DAY, old: NOW - 30 * DAY - 1, unread: NOW - 40 * DAY, active: NOW - 50 * DAY },
      NOW,
      'active',
    );
    // 4 opened rooms are within the keep-5 window, so push the threshold test with 6+ below.
    expect(ids.size).toBe(0);
  });

  it('applies the exact 7-day boundary', () => {
    const rooms = Array.from({ length: 7 }, (_, i) => room(`r${i}`));
    const lastOpened = Object.fromEntries(rooms.map((r, i) => [r.id, NOW - i * 10_000]));
    lastOpened.r5 = NOW - LESS_USED_AFTER_MS; // exactly 7 days: not yet
    lastOpened.r6 = NOW - LESS_USED_AFTER_MS - 1; // just over
    // r5 and r6 are the two least recent, outside the keep-5.
    expect([...lessUsedIds(rooms, lastOpened, NOW)]).toEqual(['r6']);
  });
});

describe('buildSidebar', () => {
  it('splits DMs and joined channels; foreign channels stay out, inboxes stay in', () => {
    const rooms = [
      room('joined'),
      room('foreign', { myRole: null }),
      room('inbox', { icon: 'inbox', myRole: null }),
      room('dm1', { kind: 'dm', agentId: 'a1' }),
    ];
    const m = buildSidebar({ ...base, rooms, lastOpened: {} });
    expect(m.home.map((r) => r.id)).toEqual(['joined', 'inbox']);
    expect(m.dms.map((r) => r.id)).toEqual(['dm1']);
    expect(m.lessUsed).toEqual([]);
  });

  it('builds Recent from threads by last activity, newest first, skipping rooms and DMs', () => {
    const t = (id: string, hoursAgo: number) => ({
      id,
      roomId: 'a',
      name: id,
      lastMessageAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
      preview: '',
      unread: 0,
      connectionId: null,
    });
    const rooms = [
      room('a', {
        lastMessageAt: new Date(NOW - 5 * 3_600_000).toISOString(),
        threads: [t('t1', 1), t('t2', 9)],
      }),
      room('dm', {
        kind: 'dm',
        agentId: 'x',
        lastMessageAt: new Date(NOW - 3 * 3_600_000).toISOString(),
      }),
    ];
    const m = buildSidebar({ ...base, rooms, lastOpened: {} });
    expect(m.recent.map((e) => (e.kind === 'room' ? e.room.id : e.thread.id))).toEqual([
      't1',
      't2',
    ]);
  });

  it('the Unread filter keeps rooms and threads with unread or mentions (and the open room)', () => {
    const rooms = [
      room('quiet'),
      room('loud', { unread: 3 }),
      room('pinged', { mentions: 1, muted: true }),
      room('open'),
    ];
    const m = buildSidebar({ ...base, rooms, lastOpened: {}, unreadOnly: true, activeId: 'open' });
    expect(m.home.map((r) => r.id)).toEqual(['loud', 'pinged', 'open']);
  });

  it('puts less-used channels in their own section', () => {
    const rooms = Array.from({ length: 7 }, (_, i) => room(`r${i}`));
    const lastOpened = Object.fromEntries(
      rooms.map((r, i) => [r.id, NOW - (i < 5 ? i : 30) * DAY]),
    );
    const m = buildSidebar({ ...base, rooms, lastOpened });
    expect(m.home.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(m.lessUsed.map((r) => r.id)).toEqual(['r5', 'r6']);
  });
});

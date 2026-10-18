import type { PinItem, Room, Thread } from '@repo/shared';

export const LESS_USED_AFTER_MS = 7 * 24 * 3_600_000;
export const KEEP_RECENT_CHANNELS = 5;
export const RECENT_LIMIT = 10;

export type RecentEntry =
  | { kind: 'room'; room: Room; at: string }
  | { kind: 'thread'; room: Room; thread: Thread; at: string };

export interface SidebarModel {
  pinned: PinItem[];
  /** Channels the caller is in (and connection inboxes), minus the "less used" ones. */
  home: Room[];
  recent: RecentEntry[];
  /** Channels not opened for 7 days, except the 5 most recently opened. */
  lessUsed: Room[];
  dms: Room[];
}

export interface SidebarInput {
  rooms: Room[];
  pins: PinItem[];
  /** Last time each room was opened (epoch ms). Rooms without an entry count as recent. */
  lastOpened: Record<string, number>;
  now: number;
  /** Only rooms/threads with unread messages or mentions. */
  unreadOnly?: boolean;
  /** The room on screen: it never goes to "less used". */
  activeId?: string;
}

export const hasUnread = (x: { unread?: number; mentions?: number }) =>
  (x.unread ?? 0) > 0 || (x.mentions ?? 0) > 0;

/** `99+` above 99. */
export const capCount = (n: number) => (n > 99 ? '99+' : String(n));

/** A channel the caller belongs to; inboxes are visible to everyone. */
export const isJoinedChannel = (r: Room) =>
  r.kind === 'channel' && (r.icon === 'inbox' || r.myRole !== null);

/** Channels to demote to "Less used". */
export function lessUsedIds(
  channels: Room[],
  lastOpened: Record<string, number>,
  now: number,
  activeId?: string,
): Set<string> {
  const opened = channels
    .filter((r) => lastOpened[r.id] !== undefined)
    .sort((a, b) => lastOpened[b.id]! - lastOpened[a.id]!);
  const keep = new Set(opened.slice(0, KEEP_RECENT_CHANNELS).map((r) => r.id));
  const out = new Set<string>();
  for (const r of opened) {
    if (keep.has(r.id) || r.id === activeId || hasUnread(r)) continue;
    if (now - lastOpened[r.id]! > LESS_USED_AFTER_MS) out.add(r.id);
  }
  return out;
}

export function buildSidebar(input: SidebarInput): SidebarModel {
  const { rooms, pins, lastOpened, now, unreadOnly, activeId } = input;
  const keepRoom = (r: Room) => !unreadOnly || hasUnread(r) || r.id === activeId;
  const dms = rooms.filter((r) => r.kind === 'dm');
  const channels = rooms.filter(isJoinedChannel);
  const lessIds = lessUsedIds(channels, lastOpened, now, activeId);

  // Threads only. Rooms already sit in Home or Less used, and DMs have their own section.
  const recent: RecentEntry[] = rooms
    .flatMap((room) =>
      room.threads.map((thread): RecentEntry => ({
        kind: 'thread',
        room,
        thread,
        at: thread.lastMessageAt,
      })),
    )
    .filter((e) => (!unreadOnly ? true : hasUnread(e.kind === 'room' ? e.room : e.thread)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_LIMIT);

  return {
    pinned: pins,
    home: channels.filter((r) => !lessIds.has(r.id) && keepRoom(r)),
    recent,
    lessUsed: channels.filter((r) => lessIds.has(r.id) && keepRoom(r)),
    dms: dms.filter(keepRoom),
  };
}

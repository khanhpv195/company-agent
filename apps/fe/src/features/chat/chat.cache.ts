import type { Message, MessageReaction, Room, RoomTimelinePage, ThreadPage } from '@repo/shared';
import type { InfiniteData } from '@tanstack/react-query';

/** Timeline pages: `pages[0]` is the newest page, later pages are older. */
export type TimelineData = InfiniteData<RoomTimelinePage>;
/** Thread pages: `pages[0]` is the first page (it holds the root), later pages are newer. */
export type ThreadData = InfiniteData<ThreadPage>;

const matches = (x: Message, m: Message) =>
  x.id === m.id ||
  (!!m.clientMessageId && x.clientMessageId === m.clientMessageId && x.author.kind === 'human');

/** Messages of a timeline, oldest first. */
export function flattenTimeline(data: TimelineData | undefined): Message[] {
  if (!data) return [];
  const out: Message[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) out.push(...data.pages[i]!.messages);
  return out;
}

/** The root plus replies of a thread, root first. */
export function flattenThread(data: ThreadData | undefined): {
  root: Message | undefined;
  replies: Message[];
  hasMore: boolean;
} {
  if (!data?.pages.length) return { root: undefined, replies: [], hasMore: false };
  return {
    root: data.pages[0]!.root,
    replies: data.pages.flatMap((p) => p.replies),
    hasMore: data.pages[data.pages.length - 1]!.hasMore,
  };
}

/** Maps every message of a timeline; returns the same object when nothing changed. */
export function mapTimeline(
  data: TimelineData | undefined,
  fn: (m: Message) => Message,
): TimelineData | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((p) => {
    const messages = p.messages.map((m) => {
      const next = fn(m);
      if (next !== m) changed = true;
      return next;
    });
    return changed ? { ...p, messages } : p;
  });
  return changed ? { ...data, pages } : data;
}

/**
 * Applies a message to a timeline: replaces a known message (by id, or by clientMessageId for a
 * sent one), appends a new root to the newest page. Replies belong to threads, not here.
 */
export function upsertTimeline(
  data: TimelineData | undefined,
  m: Message,
): TimelineData | undefined {
  if (!data) return data;
  if (m.parentId) return data;
  let found = false;
  const pages = data.pages.map((p) => {
    const i = p.messages.findIndex((x) => matches(x, m));
    if (i < 0) return p;
    found = true;
    const messages = p.messages.slice();
    // Keep the aggregated fields only the REST answers carry (thread summary) when an event lacks them.
    messages[i] = { ...m, thread: m.thread ?? messages[i]!.thread };
    return { ...p, messages };
  });
  if (found) return { ...data, pages };
  const [first, ...rest] = data.pages;
  if (!first) return data;
  return { ...data, pages: [{ ...first, messages: [...first.messages, m] }, ...rest] };
}

/** Applies a message to a thread: the root itself, or a reply (appended when everything is loaded). */
export function upsertThread(data: ThreadData | undefined, m: Message): ThreadData | undefined {
  if (!data?.pages.length) return data;
  const rootId = data.pages[0]!.root.id;
  if (m.id === rootId) {
    const [first, ...rest] = data.pages;
    return {
      ...data,
      pages: [{ ...first!, root: { ...m, thread: m.thread ?? first!.root.thread } }, ...rest],
    };
  }
  if (m.parentId !== rootId) return data;
  let found = false;
  const pages = data.pages.map((p) => {
    const i = p.replies.findIndex((x) => matches(x, m));
    if (i < 0) return p;
    found = true;
    const replies = p.replies.slice();
    replies[i] = m;
    return { ...p, replies };
  });
  if (found) return { ...data, pages };
  const last = data.pages[data.pages.length - 1]!;
  if (last.hasMore) return data; // the next page will bring it
  return {
    ...data,
    pages: [...data.pages.slice(0, -1), { ...last, replies: [...last.replies, m] }],
  };
}

export function mapThread(
  data: ThreadData | undefined,
  fn: (m: Message) => Message,
): ThreadData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      root: fn(p.root),
      replies: p.replies.map(fn),
    })),
  };
}

/** Reactions of an event: `mine` from `memberIds` when complete, else keep the cached value. */
export function mergeReactions(
  cached: MessageReaction[] | undefined,
  incoming: MessageReaction[],
  me: string | undefined,
): MessageReaction[] {
  return incoming.map((r) => {
    const complete = r.count <= r.memberIds.length;
    const mine = complete
      ? !!me && r.memberIds.includes(me)
      : (cached?.find((c) => c.key === r.key)?.mine ?? false);
    return { ...r, mine };
  });
}

/** Adds a replier to the participants of the root's thread summary (at most 5). */
export function withParticipant(root: Message, authorId: string): Message {
  const t = root.thread;
  if (!t || t.participantIds.includes(authorId) || t.participantIds.length >= 5) return root;
  return { ...root, thread: { ...t, participantIds: [...t.participantIds, authorId] } };
}

export function authorId(m: Message): string | null {
  return m.author.kind === 'external' ? null : m.author.id;
}

/** Patches one room (and optionally one of its threads) in the rooms list. */
export function patchRoom(
  rooms: Room[] | undefined,
  roomId: string,
  patch: Partial<Room>,
): Room[] | undefined {
  return rooms?.map((r) => (r.id === roomId ? { ...r, ...patch } : r));
}

export function patchRoomThread(
  rooms: Room[] | undefined,
  roomId: string,
  rootId: string,
  patch: Partial<Room['threads'][number]>,
): Room[] | undefined {
  return rooms?.map((r) =>
    r.id === roomId
      ? { ...r, threads: r.threads.map((t) => (t.id === rootId ? { ...t, ...patch } : t)) }
      : r,
  );
}

/** Timeline messages plus the outbox items of the same place that the server has not echoed yet. */
export function mergeOutbox<
  T extends Message,
  O extends { clientMessageId: string; roomId: string; parentId: string | null },
>(
  messages: T[],
  outbox: O[],
  roomId: string,
  parentId: string | null,
  toMessage: (item: O) => T,
): T[] {
  const known = new Set(messages.map((m) => m.clientMessageId).filter(Boolean));
  const pending = outbox
    .filter((o) => o.roomId === roomId && o.parentId === parentId && !known.has(o.clientMessageId))
    .map(toMessage);
  return pending.length ? [...messages, ...pending] : messages;
}

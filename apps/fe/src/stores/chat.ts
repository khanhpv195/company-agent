import type { Message, MessageQuote } from '@repo/shared';
import { create } from 'zustand';

/** A place a composer posts to: a room's main timeline or one of its threads. */
export const scopeKey = (roomId: string, parentId?: string | null) => `${roomId}:${parentId ?? ''}`;

export interface OutboxItem {
  clientMessageId: string;
  roomId: string;
  parentId: string | null;
  threadTitle?: string;
  markdown: string;
  quote?: MessageQuote | null;
  quoteMessageId?: string;
  authorId: string;
  createdAt: string;
  status: 'sending' | 'failed';
  error?: string;
}

export interface TypingEntry {
  name: string;
  /** Epoch ms after which the entry is stale. */
  until: number;
}

export const TYPING_TTL_MS = 5_000;

const LS_COLLAPSED = 'chat.collapsedSections';
const LS_OPENED = 'chat.lastOpened';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the preference just does not persist */
  }
}

interface ChatState {
  /** Messages being sent or failed to send, shown at the end of their timeline. */
  outbox: OutboxItem[];
  addOutbox: (item: OutboxItem) => void;
  patchOutbox: (clientMessageId: string, patch: Partial<OutboxItem>) => void;
  removeOutbox: (clientMessageId: string) => void;

  /** Ephemeral "x is typing" entries per scope (`scopeKey`), keyed by member id. */
  typing: Record<string, Record<string, TypingEntry>>;
  setTyping: (scope: string, memberId: string, name: string, now?: number) => void;
  clearTyping: (scope: string, memberId: string) => void;

  /** Inline notices (for example agents that were not woken), per scope. */
  notices: Record<string, string[]>;
  setNotice: (scope: string, lines: string[]) => void;

  /** Collapsed sidebar sections (persisted). */
  collapsed: string[];
  toggleCollapsed: (id: string) => void;

  /** Last time each room was opened (epoch ms, persisted): drives "Less used". */
  lastOpened: Record<string, number>;
  touchRoom: (roomId: string, at?: number) => void;

  /** Increments when the "+" menu asks the open room's composer to start a thread. */
  threadRequest: number;
  requestNewThread: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  outbox: [],
  addOutbox: (item) =>
    set((s) =>
      s.outbox.some((o) => o.clientMessageId === item.clientMessageId)
        ? s
        : { outbox: [...s.outbox, item] },
    ),
  patchOutbox: (id, patch) =>
    set((s) => ({
      outbox: s.outbox.map((o) => (o.clientMessageId === id ? { ...o, ...patch } : o)),
    })),
  removeOutbox: (id) => set((s) => ({ outbox: s.outbox.filter((o) => o.clientMessageId !== id) })),

  typing: {},
  setTyping: (scope, memberId, name, now = Date.now()) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [scope]: { ...s.typing[scope], [memberId]: { name, until: now + TYPING_TTL_MS } },
      },
    })),
  clearTyping: (scope, memberId) =>
    set((s) => {
      const cur = s.typing[scope];
      if (!cur?.[memberId]) return s;
      const next = { ...cur };
      delete next[memberId];
      return { typing: { ...s.typing, [scope]: next } };
    }),

  notices: {},
  setNotice: (scope, lines) =>
    set((s) => {
      const next = { ...s.notices };
      if (lines.length) next[scope] = lines;
      else delete next[scope];
      return { notices: next };
    }),

  collapsed: readJson<string[]>(LS_COLLAPSED, []),
  toggleCollapsed: (id) =>
    set((s) => {
      const collapsed = s.collapsed.includes(id)
        ? s.collapsed.filter((x) => x !== id)
        : [...s.collapsed, id];
      writeJson(LS_COLLAPSED, collapsed);
      return { collapsed };
    }),

  lastOpened: readJson<Record<string, number>>(LS_OPENED, {}),
  touchRoom: (roomId, at = Date.now()) =>
    set((s) => {
      const lastOpened = { ...s.lastOpened, [roomId]: at };
      writeJson(LS_OPENED, lastOpened);
      return { lastOpened };
    }),

  threadRequest: 0,
  requestNewThread: () => set((s) => ({ threadRequest: s.threadRequest + 1 })),
}));

/** Names currently typing in a scope (stale entries ignored). */
export function typingNames(
  typing: Record<string, Record<string, TypingEntry>>,
  scope: string,
  now: number,
): string[] {
  return Object.values(typing[scope] ?? {})
    .filter((e) => e.until > now)
    .map((e) => e.name);
}

/** Outbox item as a message the timeline can render. */
export type LocalMessage = Message & { local?: 'sending' | 'failed'; localError?: string };

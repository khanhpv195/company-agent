import type { Agent, Room } from '@repo/shared';
import type { TFunction } from '../../i18n';

/** "DM", "#all-members" or "#test › Hello" for a chat id. */
export function chatLabel(rooms: Room[], chatId: string, t: TFunction): string {
  const room = rooms.find((r) => r.id === chatId);
  if (room) return room.kind === 'dm' ? t('chat.dm') : `#${room.name}`;
  for (const r of rooms) {
    const t = r.threads.find((x) => x.id === chatId);
    if (t) return `#${r.name} › ${t.name}`;
  }
  return chatId;
}

/** The inbox thread a connection's sample conversation lives in (ids are server-generated). */
export function inboxThreadId(rooms: Room[], connectionId: string): string | null {
  for (const r of rooms) {
    const t = r.threads.find((x) => x.connectionId === connectionId);
    if (t) return t.id;
  }
  return null;
}

/** Text after the last "@" up to the caret, if the caret is inside a mention. */
export function mentionQuery(text: string, caret: number): string | null {
  const m = text.slice(0, caret).match(/@([\p{L}\p{N}_' ]*)$/u);
  return m ? m[1] : null;
}

/** Replace the mention being typed with the full name. Returns the new text and caret. */
export function applyMention(text: string, caret: number, name: string) {
  const before = text.slice(0, caret).replace(/@([\p{L}\p{N}_' ]*)$/u, `@${name} `);
  return { text: before + text.slice(caret), caret: before.length };
}

/** Live agents that have no DM room yet, in the order given. Deleted agents are absent from the list. */
export function agentsWithoutDm(agents: Agent[], rooms: Room[]): Agent[] {
  const withDm = new Set(rooms.filter((r) => r.kind === 'dm').map((r) => r.agentId));
  return agents.filter((a) => !withDm.has(a.id));
}

/** Where a legacy `/chat/<id>` URL really points: a room, or a thread root of a room. */
export function resolveLegacyChatId(
  rooms: Room[],
  id: string,
): { roomId: string; thread?: string } | null {
  if (rooms.some((r) => r.id === id)) return { roomId: id };
  for (const r of rooms)
    if (r.threads.some((th) => th.id === id)) return { roomId: r.id, thread: id };
  return null;
}

/** A titled thread keeps its title. Otherwise the first line of the root message, capped at 120. */
export function threadLabel(
  title: string | null | undefined,
  markdown: string | null | undefined,
): string {
  const named = title?.trim();
  if (named) return named;
  const line =
    (markdown ?? '')
      .replace(/\*\*|`/g, '')
      .split('\n')[0]
      ?.trim() ?? '';
  if (!line) return '';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** "12s" or "2m 5s" for an agent run. */
export function workedFor(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

const RUNNING_PHASES = new Set(['queued', 'thinking', 'tool', 'writing']);

/** An agent reply that can still be stopped. */
export function agentRunning(m: {
  author: { kind: string };
  status?: string;
  phase?: string | null;
}): boolean {
  if (m.author.kind !== 'agent') return false;
  if (m.status === 'streaming') return true;
  return !!m.phase && RUNNING_PHASES.has(m.phase);
}

export function canEditMessage(
  me: string | undefined,
  author: { kind: string; id?: string },
): boolean {
  return !!me && author.kind === 'human' && author.id === me;
}

/** Own messages, plus a room owner or a workspace owner/admin (the server is the final check). */
export function canDeleteMessage(opts: {
  me: string | undefined;
  author: { kind: string; id?: string };
  myRoomRole?: string | null;
  workspaceRole?: string;
}): boolean {
  if (!opts.me) return false;
  if (opts.author.kind === 'human' && opts.author.id === opts.me) return true;
  if (opts.myRoomRole === 'owner') return true;
  return opts.workspaceRole === 'owner' || opts.workspaceRole === 'admin';
}

export const EMOJI_SET = ['👍', '❤️', '😄', '🎉', '👀', '🚀', '✅', '🔥'] as const;

/** Pastes longer than this are refused in the composer (there is no attachment yet). */
export const LONG_PASTE_CHARS = 8_000;

export function draftStorageKey(roomId: string, parentId?: string | null): string {
  return `chat.draft:${roomId}:${parentId ?? ''}`;
}

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private window or blocked storage: the draft just does not persist */
  }
}

/** Thread title edit: the root author, the room owner, or a workspace owner/admin. */
export function canRenameThread(opts: {
  me: string | undefined;
  rootAuthorId: string | null;
  myRoomRole: Room['myRole'];
  workspaceRole: string | undefined;
}): boolean {
  if (!opts.me) return false;
  return (
    opts.rootAuthorId === opts.me ||
    opts.myRoomRole === 'owner' ||
    opts.workspaceRole === 'owner' ||
    opts.workspaceRole === 'admin'
  );
}

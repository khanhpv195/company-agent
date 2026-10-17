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

import type { Room } from '@repo/shared';

/** "DM", "#all-members" or "#test › Hello" for a chat id. */
export function chatLabel(rooms: Room[], chatId: string): string {
  const room = rooms.find((r) => r.id === chatId);
  if (room) return room.kind === 'dm' ? 'DM' : `#${room.name}`;
  for (const r of rooms) {
    const t = r.threads.find((x) => x.id === chatId);
    if (t) return `#${r.name} › ${t.name}`;
  }
  return chatId;
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

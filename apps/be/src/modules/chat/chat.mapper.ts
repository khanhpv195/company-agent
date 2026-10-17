import type {
  Message,
  MessageAuthor,
  Room as RoomContract,
  Thread as ThreadContract,
} from '@repo/shared';
import type { Assignment } from '../gateway/entities/assignment.entity';
import type { ChatMessage } from './entities/chat-message.entity';
import type { Room } from './entities/room.entity';
import type { Thread } from './entities/thread.entity';

export const toAssignment = (row: Assignment): NonNullable<Message['assignment']> => ({
  id: row.id,
  agentId: row.agentId,
  status: row.status,
  toolCalls: row.toolLog ?? [],
  turns: row.turns,
  error: row.error,
});

const authorOf = (row: ChatMessage): MessageAuthor => {
  if (row.authorKind === 'human') return { kind: 'human', id: row.authorMemberId ?? '' };
  if (row.authorKind === 'agent') return { kind: 'agent', id: row.authorAgentId ?? '' };
  return {
    kind: 'external',
    connectionId: row.externalConnectionId ?? '',
    name: row.externalName ?? '',
  };
};

/** `row.assignment` must be loaded for agent replies. */
export const toMessage = (row: ChatMessage): Message => ({
  id: row.id,
  chatId: row.chatId,
  author: authorOf(row),
  createdAt: row.createdAt.toISOString(),
  status: row.status,
  markdown: row.markdown,
  assignment: row.assignment ? toAssignment(row.assignment) : null,
  draft: row.draft ?? null,
});

export interface LastMessage {
  markdown: string;
  createdAt: Date;
}

export const toThread = (
  row: Thread,
  last: LastMessage | undefined,
  unread: number,
  preview: (markdown: string) => string,
): ThreadContract => ({
  id: row.id,
  roomId: row.roomId,
  name: row.name,
  lastMessageAt: (last?.createdAt ?? row.createdAt).toISOString(),
  preview: last ? preview(last.markdown) : '',
  unread,
  connectionId: row.connectionId,
});

export const toRoom = (
  row: Room,
  threads: ThreadContract[],
  last: LastMessage | undefined,
  preview: (markdown: string) => string,
): RoomContract => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  icon: row.icon,
  isPrivate: row.isPrivate,
  agentId: row.agentId,
  lastMessageAt: (last?.createdAt ?? row.createdAt).toISOString(),
  preview: last ? preview(last.markdown) : '',
  threads,
});

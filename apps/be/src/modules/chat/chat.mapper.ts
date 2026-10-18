import type {
  AgentTurnPhase,
  Message,
  MessageAuthor,
  MessageReaction,
  MessageQuote,
  MessageThread,
  Room as RoomContract,
  RoomKind,
  Thread as ThreadContract,
} from '@repo/shared';
import type { Assignment } from '../gateway/entities/assignment.entity';
import type { ChatMessage } from './entities/chat-message.entity';
import type { Room } from './entities/room.entity';

export const toAssignment = (row: Assignment): NonNullable<Message['assignment']> => ({
  id: row.id,
  agentId: row.agentId,
  status: row.status,
  toolCalls: row.toolLog ?? [],
  turns: row.turns,
  costUsd: row.costUsd,
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

const QUEUED_STATUSES = ['pending', 'offered', 'claimed'];

/**
 * What an agent reply is doing: from its message status, its run and whether text has arrived.
 * A running reply is `tool` while its last tool call runs, `writing` once text exists, else
 * `thinking`; a run that has not started yet is `queued`.
 */
export const turnPhaseOf = (
  status: Message['status'],
  assignment: Pick<NonNullable<Message['assignment']>, 'status' | 'toolCalls'> | null,
  hasText: boolean,
): { phase: AgentTurnPhase; activeTool: string | null } => {
  if (status === 'stopped') return { phase: 'stopped', activeTool: null };
  if (status === 'failed') return { phase: 'failed', activeTool: null };
  if (status === 'complete') return { phase: 'done', activeTool: null };
  if (!assignment || QUEUED_STATUSES.includes(assignment.status)) {
    return { phase: 'queued', activeTool: null };
  }
  const active = [...assignment.toolCalls].reverse().find((call) => call.status === 'running');
  if (assignment.status === 'running' && active) return { phase: 'tool', activeTool: active.name };
  return { phase: hasText ? 'writing' : 'thinking', activeTool: null };
};

/** A streaming message with the text streamed so far (held in memory): its phase follows the text. */
export const withStreamedText = (message: Message, text: string): Message =>
  message.phase
    ? {
        ...message,
        markdown: text,
        ...turnPhaseOf(message.status, message.assignment, text.length > 0),
      }
    : { ...message, markdown: text };

/** Realtime events are shared between viewers: no per-viewer `mine` on reactions. */
export const withoutMine = (message: Message): Message =>
  message.reactions?.some((reaction) => reaction.mine !== undefined)
    ? {
        ...message,
        reactions: message.reactions.map(({ mine: _mine, ...reaction }) => reaction),
      }
    : message;

/** What `toMessage` cannot read off the row itself. */
export interface MessageExtras {
  /** DM main-timeline messages carry the DM room id as their legacy `chatId`. */
  roomKind: RoomKind;
  thread?: MessageThread;
  quote?: MessageQuote | null;
  reactions?: MessageReaction[];
}

/** `row.assignment` must be loaded for agent replies. A soft-deleted message loses its content. */
export const toMessage = (
  row: ChatMessage,
  extras: MessageExtras = { roomKind: 'channel' },
): Message => {
  const deleted = row.deletedAt != null;
  const assignment = !deleted && row.assignment ? toAssignment(row.assignment) : null;
  // Agent replies (a message with a run) carry the turn phase and timing.
  const turn =
    !deleted && row.authorKind === 'agent' && row.assignmentId
      ? {
          ...turnPhaseOf(row.status, assignment, row.markdown.length > 0),
          startedAt: row.assignment?.startedAt ? row.assignment.startedAt.toISOString() : null,
          workedMs:
            row.assignment?.startedAt && row.assignment.endedAt
              ? Math.max(0, row.assignment.endedAt.getTime() - row.assignment.startedAt.getTime())
              : null,
        }
      : undefined;
  return {
    id: row.id,
    // A DM main message belongs to the DM; a reply to its thread root; any other main-timeline
    // message is the (potential) root of a thread of its own.
    chatId: row.parentId ?? (extras.roomKind === 'dm' ? row.roomId : row.id),
    roomId: row.roomId,
    parentId: row.parentId ?? null,
    ...(row.seq !== undefined ? { seq: Number(row.seq) } : {}),
    author: authorOf(row),
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    markdown: deleted ? '' : row.markdown,
    assignment,
    draft: deleted ? null : (row.draft ?? null),
    threadTitle: row.parentId ? null : (row.threadTitle ?? null),
    ...(!deleted && extras.thread ? { thread: extras.thread } : {}),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted,
    quote: deleted ? null : (extras.quote ?? null),
    clientMessageId: row.clientMessageId ?? null,
    reactions: deleted ? [] : (extras.reactions ?? []),
    ...turn,
  };
};

export interface LastMessage {
  markdown: string;
  createdAt: Date;
}

/** A thread without a title is named after the first line of its root message. */
export const threadNameOf = (
  root: Pick<ChatMessage, 'threadTitle' | 'markdown'>,
  preview: (markdown: string) => string,
): string => {
  const title = root.threadTitle?.trim();
  if (title) return title;
  const line = preview(root.markdown).trim();
  return line ? (line.length > 120 ? `${line.slice(0, 117)}...` : line) : 'Thread';
};

/** The legacy sidebar view of a thread: a root message (its id is the thread id). */
export const toThread = (
  root: ChatMessage,
  last: LastMessage | undefined,
  unread: number,
  preview: (markdown: string) => string,
  connectionId: string | null,
  extra: Partial<ThreadContract> = {},
): ThreadContract => ({
  id: root.id,
  roomId: root.roomId,
  name: threadNameOf(root, preview),
  lastMessageAt: (last?.createdAt ?? root.createdAt).toISOString(),
  preview: preview((last ?? root).markdown),
  unread,
  connectionId,
  ...extra,
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

export type AssignmentStatus =
  'pending' | 'offered' | 'claimed' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output: string | null;
  status: 'running' | 'ok' | 'error';
}

export interface Assignment {
  id: string;
  agentId: string;
  status: AssignmentStatus;
  toolCalls: ToolCall[];
  turns: number;
  /** Reported by a real daemon when the run ends; null while running or for simulated runs. */
  costUsd: number | null;
  error: string | null;
}

export type MessageAuthor =
  | { kind: 'human'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'external'; connectionId: string; name: string };

export interface MessageDraft {
  connectionId: string;
  state: 'pending' | 'sent';
}

/** The thread a root message starts (replies share `parentId` = the root id). */
export interface MessageThread {
  /** Null while the thread has no title. */
  title: string | null;
  /** Live (not deleted) replies. */
  replyCount: number;
  lastReplyAt: string | null;
  /** The root author and the repliers (humans: member ids, agents: agent ids), at most 5. */
  participantIds: string[];
}

/** The message a message quotes. */
export interface MessageQuote {
  id: string;
  authorName: string;
  /** First characters of the quoted text; empty when it was deleted. */
  excerpt: string;
}

/** A mentioned agent that was not woken by a message. */
export interface SkippedAgent {
  agentId: string;
  name: string;
  /** `offline`: its computer is offline; `not_in_room`: it is not part of the room; `limit`: more than 3 agents were mentioned. */
  reason: 'offline' | 'not_in_room' | 'limit';
}

/** One emoji reaction on a message, aggregated over members. */
export interface MessageReaction {
  /** The emoji itself (unicode, 1..32 characters, no whitespace). */
  key: string;
  count: number;
  /**
   * Whether the caller reacted. Present in REST answers; absent in realtime events (events are
   * shared between viewers): derive it from `memberIds` when `count <= memberIds.length`, else
   * keep the cached value.
   */
  mine?: boolean;
  /** The first (at most 10) reacting member ids, oldest reaction first. */
  memberIds: string[];
}

/** What an agent reply is doing right now (`done`, `failed` and `stopped` are final). */
export type AgentTurnPhase =
  'queued' | 'thinking' | 'tool' | 'writing' | 'done' | 'failed' | 'stopped';

export type MessageStatus = 'streaming' | 'complete' | 'failed' | 'stopped';

export interface Message {
  id: string;
  /**
   * Legacy chat id: the DM room id for a DM main-timeline message, otherwise the thread root
   * message id (a channel main-timeline message that has no thread yet carries its own id).
   */
  chatId: string;
  /** Room the message belongs to (always set by the API). */
  roomId?: string;
  /** Root message of the thread this message replies to; null on the main timeline. */
  parentId?: string | null;
  /** Arrival order inside the room (the paging cursor of `beforeSeq` / `afterSeq`). */
  seq?: number;
  author: MessageAuthor;
  createdAt: string;
  /** `stopped`: a member stopped the agent mid-reply; `markdown` keeps the partial text. */
  status: MessageStatus;
  markdown: string;
  assignment: Assignment | null;
  /** Reply to an external channel that waits for a human before it is sent. */
  draft: MessageDraft | null;
  /** Roots only: the title of the thread this message starts. */
  threadTitle?: string | null;
  /** Roots with a title or replies: the thread summary. */
  thread?: MessageThread;
  editedAt?: string | null;
  /** Soft-deleted: `markdown` is empty and clients show a placeholder. */
  deleted?: boolean;
  quote?: MessageQuote | null;
  clientMessageId?: string | null;
  /** Reactions grouped by emoji, oldest first (always present from the API, empty when none). */
  reactions?: MessageReaction[];
  /** Agent replies only (a message with a run): the turn phase. */
  phase?: AgentTurnPhase;
  /** Agent replies in phase `tool`: the tool in use. */
  activeTool?: string | null;
  /** Agent replies: when the run started (null while it is queued). */
  startedAt?: string | null;
  /** Agent replies: how long the run took, once it ended (null while queued or running). */
  workedMs?: number | null;
  /** Only in the answer to a send: mentioned agents that were not woken (events never carry it). */
  skippedAgents?: SkippedAgent[];
}

export interface SendMessageInput {
  markdown: string;
  /** Agent to wake up; the server also detects @mentions in the text. */
  agentId?: string;
}

/** `POST /rooms/:id/messages`. */
export interface PostRoomMessageInput extends SendMessageInput {
  /** Reply in the thread of this message (a reply id attaches to its root). */
  parentId?: string;
  /** 1..120 characters; only for a new root (no `parentId`): it starts a titled thread. */
  threadTitle?: string;
  quoteMessageId?: string;
  /** Idempotency key: the same (room, author, id) returns the message already stored. */
  clientMessageId?: string;
}

/** `GET /rooms/:id/messages`: the main timeline, oldest first within the page. */
export interface RoomTimelinePage {
  messages: Message[];
  /** Older messages exist before the first one of this page. */
  hasMore: boolean;
}

/** `GET /rooms/:id/messages/:rootId/thread`. */
export interface ThreadPage {
  root: Message;
  replies: Message[];
  /** More replies exist after the last one of this page. */
  hasMore: boolean;
}

/** `GET /mentions`: one message that mentions the caller, with where it lives. */
export interface MentionItem {
  message: Message;
  roomId: string;
  roomName: string;
  roomKind: 'dm' | 'channel';
  /** Root of the thread the message is in; null for a main-timeline message. */
  threadRootId: string | null;
  threadTitle: string | null;
}

export interface MentionFeedPage {
  items: MentionItem[];
  hasMore: boolean;
}

/** Answer of the read / unread routes: the cursor and the counts it leaves. */
export interface ReadState {
  roomId: string;
  /** The thread's root message id; null for the room's main timeline. */
  rootId: string | null;
  lastReadSeq: number;
  unread: number;
  mentions: number;
}

export type PinTargetType = 'room' | 'thread' | 'message';

/** `GET /pins`: a pinned item resolved for display (targets the caller can no longer open are left out). */
export interface PinItem {
  id: string;
  targetType: PinTargetType;
  /** The room id, the thread root message id or the message id. */
  targetId: string;
  roomId: string;
  roomName: string;
  roomKind: 'dm' | 'channel';
  /** Room name, thread name or the first line of the message. */
  title: string;
  /** Message id inside a pinned thread/message: the thread root or the message itself; null for a room. */
  messageId: string | null;
  /** Root of the thread the pinned message lives in (a thread pin: its own id); null for a room or a main-timeline message. */
  threadRootId: string | null;
  position: number;
}

export interface CreatePinInput {
  targetType: PinTargetType;
  targetId: string;
}

export interface ReorderPinsInput {
  /** Pin ids, first = top; pins not listed follow in their old order. */
  ids: string[];
}

export interface PresenceEntry {
  memberId: string;
  status: PresenceStatus;
}

export type PresenceStatus = 'online' | 'idle' | 'offline';

/** Answer of the mute / unmute routes. */
export interface MuteState {
  roomId: string;
  /** The thread's root message id; null when a room was muted. */
  rootId: string | null;
  muted: boolean;
}

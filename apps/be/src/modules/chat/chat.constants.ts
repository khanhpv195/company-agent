/** Longest message a member can send. */
export const MAX_MESSAGE_LENGTH = 20_000;
/** `GET /chats/:id/messages` (legacy) returns at most this many (the latest ones). */
export const MESSAGES_PAGE_LIMIT = 200;
/** `GET /rooms/:id/messages` and the thread route: default and maximum page size. */
export const TIMELINE_PAGE_DEFAULT = 50;
export const TIMELINE_PAGE_MAX = 100;
/** One message wakes at most this many agents (explicit agent first, then @mentions in order). */
export const MAX_WAKE_PER_MESSAGE = 3;

/** Domain event: an agent reply was created and waits for a runner (simulator or daemon). */
export const CHAT_REPLY_REQUESTED_EVENT = 'chat.reply.requested';
/** Domain event: a chat reply run finished (Phase 6 feeds the dashboard from it). */
export const CHAT_RUN_ENDED_EVENT = 'chat.run.ended';

export interface ChatReplyRequestedPayload {
  workspaceId: string;
  assignmentId: string;
}

export interface ChatRunEndedPayload {
  workspaceId: string;
  agentId: string;
  ok: boolean;
  durationSec: number;
  /** First line of the request, markdown stripped. Empty for a DM or private channel (its text stays private). */
  preview: string;
  /** The run answered a DM: workspace-visible rows must not carry its text. */
  dm: boolean;
  /** The run answered in a private channel: workspace-visible rows carry neither text nor room name. */
  privateRoom?: boolean;
}

/** Longest channel name. */
export const ROOM_NAME_MAX = 80;
/** Longest thread name. */
export const THREAD_NAME_MAX = 120;
/** Most members plus agents one request may add. */
export const MAX_ROOM_ADDS = 200;

/** Most pins one member may keep. */
export const MAX_PINS = 50;
/** Typing events of one member in one room (thread) go out at most this often. */
export const TYPING_THROTTLE_MS = 2000;
/** `GET /rooms/:id/threads` and `GET /mentions`: default and maximum page size. */
export const THREAD_LIST_DEFAULT = 100;
export const THREAD_LIST_MAX = 200;
export const MENTIONS_PAGE_DEFAULT = 30;
export const MENTIONS_PAGE_MAX = 100;

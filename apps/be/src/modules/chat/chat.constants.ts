/** Longest message a member can send. */
export const MAX_MESSAGE_LENGTH = 20_000;
/** `GET /chats/:id/messages` returns at most this many (the latest ones). */
export const MESSAGES_PAGE_LIMIT = 200;

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
  /** First line of the request, markdown stripped. Empty for a DM (its text stays private). */
  preview: string;
  /** The run answered a DM: workspace-visible rows must not carry its text. */
  dm: boolean;
}

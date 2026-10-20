import type { Message, MessageReaction, PresenceStatus } from './message.interface';

export type RealtimeEvent =
  | { type: 'message.upserted'; message: Message }
  /** A thread's title or reply counters changed (sent to the room's audience, like its messages). */
  | {
      type: 'thread.updated';
      roomId: string;
      rootId: string;
      title: string | null;
      replyCount: number;
      lastReplyAt: string | null;
    }
  /** Reactions of a message changed (aggregated list without `mine`; see `MessageReaction`). */
  | {
      type: 'message.reactions_updated';
      roomId: string;
      messageId: string;
      parentId: string | null;
      reactions: MessageReaction[];
    }
  /** Only to the member themself: their read cursor of a room (`rootId` null) or thread moved. */
  | {
      type: 'read.updated';
      roomId: string;
      rootId: string | null;
      lastReadSeq: number;
      unread: number;
      mentions: number;
    }
  /** Only to the member themself: their pins changed (refetch `GET /pins`). */
  | { type: 'pins.changed' }
  /** Ephemeral (not stored): someone is typing; to the room audience except the sender. */
  | {
      type: 'presence.typing';
      roomId: string;
      parentId: string | null;
      memberId: string;
      name: string;
    }
  | { type: 'presence.update'; memberId: string; status: PresenceStatus }
  | { type: 'rooms.changed' }
  /** Departments, or who belongs to which, changed (refetch departments and people). */
  | { type: 'departments.changed' }
  /** The skill library, or which agent has which skill, changed (refetch skills and agents). */
  | { type: 'skills.changed' }
  | { type: 'tasks.changed' }
  | { type: 'agents.changed' }
  | { type: 'computers.changed' }
  | { type: 'connections.changed' }
  | { type: 'dashboard.changed' }
  /** Members, roles or pending invites changed (also a signal to refetch the session). */
  | { type: 'members.changed' }
  /** Workspace name or owner changed. */
  | { type: 'workspace.changed' }
  | {
      type: 'notice';
      /** Inline markdown. */
      text: string;
      agentId: string | null;
      taskId: string | null;
    };

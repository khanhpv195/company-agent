import type { Message } from './message.interface';

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
  | { type: 'rooms.changed' }
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

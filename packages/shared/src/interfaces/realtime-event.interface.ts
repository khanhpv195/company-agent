import type { Message } from './message.interface';

export type RealtimeEvent =
  | { type: 'message.upserted'; message: Message }
  | { type: 'rooms.changed' }
  | { type: 'tasks.changed' }
  | { type: 'agents.changed' }
  | { type: 'computers.changed' }
  | { type: 'connections.changed' }
  | { type: 'dashboard.changed' }
  | {
      type: 'notice';
      /** Inline markdown. */
      text: string;
      agentId: string | null;
      taskId: string | null;
    };

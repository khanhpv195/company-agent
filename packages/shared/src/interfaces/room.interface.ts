export type RoomKind = 'dm' | 'channel';
export type RoomIcon = 'users' | 'sparkles' | 'hourglass' | 'inbox';

/** A conversation inside a channel. DMs have no threads; their messages live on the room itself. */
export interface Thread {
  id: string;
  roomId: string;
  name: string;
  lastMessageAt: string;
  preview: string;
  unread: number;
  /** Set when the thread mirrors an external conversation (Zalo, Facebook, Gmail). */
  connectionId: string | null;
}

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  icon: RoomIcon;
  isPrivate: boolean;
  /** DM partner. */
  agentId: string | null;
  lastMessageAt: string;
  preview: string;
  threads: Thread[];
}

/** A place messages are posted to: a DM room or a channel thread. */
export interface Chat {
  id: string;
  kind: 'dm' | 'thread';
  title: string;
  /** "# channel" for threads. */
  subtitle: string | null;
  agentIds: string[];
}

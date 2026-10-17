export type RoomKind = 'dm' | 'channel';
export type RoomMemberRole = 'owner' | 'member';
export type RoomIcon = 'users' | 'sparkles' | 'hourglass' | 'inbox';

/**
 * Legacy view of a thread for the sidebar: a root message of a channel that has a title or
 * replies (`id` = the root message id). The room's main timeline holds the messages.
 */
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
  /** Live human members of a channel (absent on DMs and from older servers). */
  memberCount?: number;
  /** Live agents of a channel (absent on DMs and from older servers). */
  agentCount?: number;
  /** The channel every new member joins; it cannot be deleted or made private (absent on DMs and from older servers). */
  isDefault?: boolean;
  /** The caller's role in the channel; null for DMs and connection inboxes they were not added to. */
  myRole?: RoomMemberRole | null;
}

/** A place messages are posted to: a DM room (main timeline) or a thread (root message id). */
export interface Chat {
  id: string;
  kind: 'dm' | 'thread';
  title: string;
  /** "# channel" for threads. */
  subtitle: string | null;
  agentIds: string[];
}

/** A human member of a room. */
export interface RoomMember {
  memberId: string;
  name: string;
  color: string | null;
  /** Role inside the room (not the workspace role). */
  role: RoomMemberRole;
  joinedAt: string;
}

/** An agent that belongs to a room (only these are woken by @mentions there). */
export interface RoomAgent {
  agentId: string;
  name: string;
  avatar: number;
  joinedAt: string;
}

export interface RoomMembers {
  members: RoomMember[];
  agents: RoomAgent[];
}

/** A public channel the caller has not joined (`GET /rooms/browse`). */
export interface BrowseRoom {
  id: string;
  name: string;
  icon: RoomIcon;
  memberCount: number;
  agentCount: number;
}

export interface CreateRoomInput {
  /** 1..80 characters, unique among the workspace's channels (case-insensitive). */
  name: string;
  isPrivate?: boolean;
  memberIds?: string[];
  agentIds?: string[];
}

export interface UpdateRoomInput {
  name?: string;
  isPrivate?: boolean;
}

export interface AddRoomMembersInput {
  memberIds?: string[];
  agentIds?: string[];
}

export interface CreateThreadInput {
  /** 1..120 characters. */
  name: string;
  /**
   * Posted as the first message through the normal send path: @mentions in it wake agents (the
   * name is only a fallback text and is never searched for mentions). The answer is that root
   * `Message` (not a thread object).
   */
  message?: string;
}

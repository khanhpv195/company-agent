import type {
  Agent,
  ConnectInput,
  MentionFeedPage,
  Message,
  MessageAuthor,
  MessageReaction,
  MuteState,
  AddRoomMembersInput,
  BrowseRoom,
  CreateRoomInput,
  PinItem,
  PostRoomMessageInput,
  PresenceEntry,
  ReadState,
  Room,
  RoomMembers,
  UpdateRoomInput,
  RoomTimelinePage,
  Thread,
  ThreadFilter,
  ThreadPage,
  ToolCall,
} from '@repo/shared';
import { HttpError, type MockBackend } from './backend';
import { iso } from './fixtures';

const sleep = (b: MockBackend, ms: number) => new Promise<void>((resolve) => b.later(resolve, ms));
const preview = (markdown: string) => markdown.replace(/\*\*|`/g, '').split('\n')[0] ?? '';

// ---------- lookups ----------

const roomOf = (b: MockBackend, roomId: string): Room => {
  const room = b.db.rooms.find((r) => r.id === roomId);
  if (!room) throw new HttpError(404, `Room ${roomId} not found`);
  return room;
};
const all = (b: MockBackend, roomId: string): Message[] => (b.db.messages[roomId] ??= []);
const isMine = (b: MockBackend, m: Message) =>
  m.author.kind === 'human' && m.author.id === b.db.meId;
const meName = (b: MockBackend) => b.db.members.find((m) => m.id === b.db.meId)?.name ?? '';
const mentionsMe = (b: MockBackend, m: Message) =>
  !!meName(b) && m.markdown.toLowerCase().includes(`@${meName(b).toLowerCase()}`);
const rootIdOf = (list: Message[], id: string): string | null => {
  const m = list.find((x) => x.id === id);
  return m ? (m.parentId ?? m.id) : null;
};
const lastSeq = (list: Message[]) => Math.max(0, ...list.map((m) => m.seq ?? 0));
const threadKey = (roomId: string, rootId: string) => `${roomId}:${rootId}`;

/** A root's thread summary (live replies only). */
function summaryOf(list: Message[], root: Message): Message['thread'] | undefined {
  const replies = list.filter((m) => m.parentId === root.id && !m.deleted);
  if (!replies.length && !root.threadTitle) return undefined;
  const ids: string[] = [];
  for (const m of [root, ...replies]) {
    if (m.author.kind === 'external') continue;
    if (!ids.includes(m.author.id)) ids.push(m.author.id);
  }
  return {
    title: root.threadTitle ?? null,
    replyCount: replies.length,
    lastReplyAt: replies.length ? replies[replies.length - 1]!.createdAt : null,
    participantIds: ids.slice(0, 5),
  };
}

function hydrate(b: MockBackend, m: Message): Message {
  const list = all(b, m.roomId ?? '');
  const copy = structuredClone(m);
  copy.reactions = (copy.reactions ?? []).map((r) => ({
    ...r,
    mine: r.memberIds.includes(b.db.meId),
  }));
  if (!m.parentId) copy.thread = summaryOf(list, m);
  if (m.quote === undefined) copy.quote = null;
  return copy;
}

const seen = (b: MockBackend, roomId: string, rootId: string | null) =>
  b.db.reads[rootId ? threadKey(roomId, rootId) : roomId] ?? 0;

function counts(b: MockBackend, list: Message[], cursor: number) {
  const fresh = list.filter((m) => !m.deleted && (m.seq ?? 0) > cursor && !isMine(b, m));
  return { unread: fresh.length, mentions: fresh.filter((m) => mentionsMe(b, m)).length };
}

function threadsOf(b: MockBackend, room: Room): Thread[] {
  const list = all(b, room.id);
  return list
    .filter(
      (m) => !m.parentId && !m.deleted && (m.threadTitle || list.some((x) => x.parentId === m.id)),
    )
    .map((root) => {
      const members = list.filter((m) => m.id === root.id || m.parentId === root.id);
      const last = members[members.length - 1]!;
      const cursor = seen(b, room.id, root.id);
      const th = summaryOf(list, root);
      const external = root.author.kind === 'external' ? root.author : null;
      return {
        id: root.id,
        roomId: room.id,
        name: root.threadTitle ?? (external ? external.name : preview(root.markdown)),
        lastMessageAt: last.createdAt,
        preview: preview(last.markdown),
        ...counts(b, members, cursor),
        connectionId: external?.connectionId ?? null,
        lastReadSeq: cursor,
        lastSeq: lastSeq(members),
        muted: b.db.mutes.includes(threadKey(room.id, root.id)),
        replyCount: th?.replyCount ?? 0,
        lastReplyAt: th?.lastReplyAt ?? null,
        participantIds: th?.participantIds ?? [],
      };
    })
    .sort((a, b2) => b2.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** Rooms with previews, counts and threads derived from their messages. */
export function listRooms(b: MockBackend): Room[] {
  const left = new Set(b.db.leftRoomIds ?? []);
  return b.db.rooms
    .filter((room) => !left.has(room.id))
    .map((room) => {
      const list = all(b, room.id);
      const last = list[list.length - 1];
      const roots = list.filter((m) => !m.parentId);
      const working = list
        .filter((m) => m.author.kind === 'agent' && m.status === 'streaming')
        .map((m) => (m.author as { id: string }).id);
      const cursor = seen(b, room.id, null);
      return {
        ...room,
        threads: room.kind === 'channel' ? threadsOf(b, room) : [],
        ...(last ? { preview: preview(last.markdown), lastMessageAt: last.createdAt } : null),
        ...(room.kind === 'channel'
          ? {
              memberCount: b.db.members.length,
              agentCount: b.db.agents.length,
              myRole: room.icon === 'inbox' ? null : ('owner' as const),
            }
          : null),
        ...counts(b, roots, cursor),
        lastReadSeq: cursor,
        muted: b.db.mutes.includes(room.id),
        workingAgentIds: [...new Set(working)],
      };
    });
}

// ---------- timelines ----------

export function timeline(
  b: MockBackend,
  roomId: string,
  beforeSeq: number | undefined,
  limit: number,
): RoomTimelinePage {
  roomOf(b, roomId);
  const roots = all(b, roomId).filter(
    (m) => !m.parentId && (beforeSeq === undefined || (m.seq ?? 0) < beforeSeq),
  );
  const page = roots.slice(-limit);
  return { messages: page.map((m) => hydrate(b, m)), hasMore: roots.length > page.length };
}

export function threadPage(
  b: MockBackend,
  roomId: string,
  rootId: string,
  afterSeq: number | undefined,
  limit: number,
): ThreadPage {
  roomOf(b, roomId);
  const list = all(b, roomId);
  const root = list.find((m) => m.id === (rootIdOf(list, rootId) ?? rootId));
  if (!root || root.deleted) throw new HttpError(404, 'Thread not found');
  const replies = list.filter(
    (m) => m.parentId === root.id && (afterSeq === undefined || (m.seq ?? 0) > afterSeq),
  );
  const page = replies.slice(0, limit);
  return {
    root: hydrate(b, root),
    replies: page.map((m) => hydrate(b, m)),
    hasMore: replies.length > page.length,
  };
}

export function roomThreads(b: MockBackend, roomId: string, filter: ThreadFilter): Thread[] {
  const room = roomOf(b, roomId);
  return threadsOf(b, room).filter((t) =>
    filter === 'unread'
      ? t.unread > 0
      : filter === 'mentioned'
        ? (t.mentions ?? 0) > 0
        : filter === 'mine'
          ? all(b, roomId).some((m) => m.parentId === t.id && isMine(b, m))
          : true,
  );
}

export function roomMembers(b: MockBackend, roomId: string): RoomMembers {
  roomOf(b, roomId);
  const roster = b.db.roster?.[roomId];
  const members = roster
    ? b.db.members.filter((m) => roster.memberIds.includes(m.id))
    : b.db.members;
  const agents = roster ? b.db.agents.filter((a) => roster.agentIds.includes(a.id)) : b.db.agents;
  return {
    members: members.map((m) => ({
      memberId: m.id,
      name: m.name,
      color: m.color ?? null,
      role: m.id === b.db.meId ? ('owner' as const) : ('member' as const),
      joinedAt: iso(b.now()),
    })),
    agents: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      avatar: a.avatar,
      joinedAt: iso(b.now()),
    })),
  };
}

function ensureRoster(b: MockBackend, roomId: string) {
  b.db.roster ??= {};
  if (!b.db.roster[roomId]) {
    b.db.roster[roomId] = {
      memberIds: b.db.members.map((m) => m.id),
      agentIds: b.db.agents.map((a) => a.id),
    };
  }
  return b.db.roster[roomId];
}

export function browseRooms(b: MockBackend): BrowseRoom[] {
  const left = new Set(b.db.leftRoomIds ?? []);
  return b.db.rooms
    .filter((r) => r.kind === 'channel' && !r.isPrivate && r.icon !== 'inbox' && left.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      memberCount: r.memberCount ?? 1,
      agentCount: r.agentCount ?? 0,
    }));
}

export function createRoom(b: MockBackend, input: CreateRoomInput): Room {
  const name = input.name?.trim();
  if (!name || name.length > 80) throw new HttpError(400, 'Invalid room name');
  if (b.db.rooms.some((r) => r.kind === 'channel' && r.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'A room with that name already exists');
  }
  const room: Room = {
    id: b.nextId('room'),
    kind: 'channel',
    name,
    icon: 'users',
    isPrivate: !!input.isPrivate,
    agentId: null,
    lastMessageAt: iso(b.now()),
    preview: '',
    threads: [],
    myRole: 'owner',
    isDefault: false,
    memberCount: 1 + (input.memberIds?.length ?? 0),
    agentCount: input.agentIds?.length ?? 0,
  };
  b.db.rooms.push(room);
  b.db.messages[room.id] = [];
  b.db.roster[room.id] = {
    memberIds: [b.db.meId, ...(input.memberIds ?? [])],
    agentIds: input.agentIds ?? [],
  };
  b.emit({ type: 'rooms.changed' });
  return room;
}

export function updateRoom(b: MockBackend, roomId: string, input: UpdateRoomInput): Room {
  const room = roomOf(b, roomId);
  if (room.kind !== 'channel') throw new HttpError(400, 'Not a channel');
  if (room.isDefault && (input.name || input.isPrivate)) {
    throw new HttpError(400, 'The default room cannot be renamed or made private');
  }
  if (input.name) {
    const name = input.name.trim();
    if (
      b.db.rooms.some(
        (r) =>
          r.id !== room.id && r.kind === 'channel' && r.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new HttpError(409, 'A room with that name already exists');
    }
    room.name = name;
  }
  if (input.isPrivate !== undefined) room.isPrivate = input.isPrivate;
  b.emit({ type: 'rooms.changed' });
  return room;
}

export function deleteRoom(b: MockBackend, roomId: string) {
  const room = roomOf(b, roomId);
  if (room.isDefault) throw new HttpError(400, 'The default room cannot be deleted');
  b.db.rooms = b.db.rooms.filter((r) => r.id !== roomId);
  delete b.db.messages[roomId];
  delete b.db.roster[roomId];
  b.emit({ type: 'rooms.changed' });
  return null;
}

export function joinRoom(b: MockBackend, roomId: string): Room {
  const room = roomOf(b, roomId);
  if (room.isPrivate) throw new HttpError(403, 'This room is private');
  b.db.leftRoomIds = (b.db.leftRoomIds ?? []).filter((id) => id !== roomId);
  const roster = ensureRoster(b, roomId);
  if (!roster.memberIds.includes(b.db.meId)) roster.memberIds.push(b.db.meId);
  b.emit({ type: 'rooms.changed' });
  return room;
}

export function leaveRoom(b: MockBackend, roomId: string) {
  const room = roomOf(b, roomId);
  if (room.kind !== 'channel' || room.icon === 'inbox') throw new HttpError(400, 'Cannot leave');
  b.db.leftRoomIds ??= [];
  if (!b.db.leftRoomIds.includes(roomId)) b.db.leftRoomIds.push(roomId);
  b.emit({ type: 'rooms.changed' });
  return null;
}

export function addRoomMembers(
  b: MockBackend,
  roomId: string,
  input: AddRoomMembersInput,
): RoomMembers {
  const roster = ensureRoster(b, roomId);
  for (const id of input.memberIds ?? [])
    if (!roster.memberIds.includes(id)) roster.memberIds.push(id);
  for (const id of input.agentIds ?? [])
    if (!roster.agentIds.includes(id)) roster.agentIds.push(id);
  b.emit({ type: 'rooms.changed' });
  return roomMembers(b, roomId);
}

export function removeRoomMember(
  b: MockBackend,
  roomId: string,
  kind: string,
  targetId: string,
): RoomMembers {
  const roster = ensureRoster(b, roomId);
  if (kind === 'agent') roster.agentIds = roster.agentIds.filter((id) => id !== targetId);
  else roster.memberIds = roster.memberIds.filter((id) => id !== targetId);
  if (kind !== 'agent' && targetId === b.db.meId) leaveRoom(b, roomId);
  b.emit({ type: 'rooms.changed' });
  return roomMembers(b, roomId);
}

export function editMessage(
  b: MockBackend,
  roomId: string,
  messageId: string,
  markdown: string,
): Message {
  const m = all(b, roomId).find((x) => x.id === messageId);
  if (!m || m.deleted) throw new HttpError(404, 'Message not found');
  if (!isMine(b, m)) throw new HttpError(403, 'You can only edit your own messages');
  const text = markdown.trim();
  if (!text) throw new HttpError(400, 'Message is empty');
  m.markdown = text;
  m.editedAt = iso(b.now());
  publish(b, m);
  return hydrate(b, m);
}

export function deleteMessage(b: MockBackend, roomId: string, messageId: string): Message {
  const m = all(b, roomId).find((x) => x.id === messageId);
  if (!m || m.deleted) throw new HttpError(404, 'Message not found');
  if (m.author.kind === 'human' && !isMine(b, m)) throw new HttpError(403, 'Forbidden');
  m.deleted = true;
  m.markdown = '';
  publish(b, m);
  return hydrate(b, m);
}

export function stopMessage(b: MockBackend, roomId: string, messageId: string): Message {
  const m = all(b, roomId).find((x) => x.id === messageId);
  if (!m || m.author.kind !== 'agent') throw new HttpError(404, 'Message not found');
  if (
    m.status !== 'streaming' &&
    m.phase &&
    !['queued', 'thinking', 'tool', 'writing'].includes(m.phase)
  ) {
    throw new HttpError(409, 'This reply is not running');
  }
  m.status = 'stopped';
  m.phase = 'stopped';
  if (m.assignment && !['completed', 'failed'].includes(m.assignment.status)) {
    m.assignment.status = 'cancelled';
  }
  publish(b, m);
  return hydrate(b, m);
}

export function markUnread(
  b: MockBackend,
  roomId: string,
  rootId: string | null,
  throughSeq: number,
): ReadState {
  roomOf(b, roomId);
  const key = rootId ? threadKey(roomId, rootId) : roomId;
  b.db.reads[key] = Math.max(0, throughSeq - 1);
  const state = readState(b, roomId, rootId);
  b.emit({ type: 'read.updated', ...state });
  return state;
}

// ---------- read state, mute, pins, mentions ----------

function readState(b: MockBackend, roomId: string, rootId: string | null): ReadState {
  const list = all(b, roomId);
  const scope = rootId
    ? list.filter((m) => m.id === rootId || m.parentId === rootId)
    : list.filter((m) => !m.parentId);
  const cursor = seen(b, roomId, rootId);
  return { roomId, rootId, lastReadSeq: cursor, ...counts(b, scope, cursor) };
}

export function markRead(
  b: MockBackend,
  roomId: string,
  rootId: string | null,
  seq: number,
): ReadState {
  roomOf(b, roomId);
  const list = all(b, roomId);
  const root = rootId ? rootIdOf(list, rootId) : null;
  if (rootId && !root) throw new HttpError(404, 'Thread not found');
  const key = root ? threadKey(roomId, root) : roomId;
  b.db.reads[key] = Math.max(b.db.reads[key] ?? 0, Math.min(seq, lastSeq(list)));
  const state = readState(b, roomId, root);
  b.emit({ type: 'read.updated', ...state });
  return state;
}

export function readAll(b: MockBackend) {
  for (const room of b.db.rooms) {
    const list = all(b, room.id);
    b.db.reads[room.id] = lastSeq(list);
    for (const m of list) if (!m.parentId) b.db.reads[threadKey(room.id, m.id)] = lastSeq(list);
  }
  b.emit({ type: 'rooms.changed' });
  return null;
}

export function setMuted(
  b: MockBackend,
  roomId: string,
  rootId: string | null,
  muted: boolean,
): MuteState {
  roomOf(b, roomId);
  const key = rootId ? threadKey(roomId, rootId) : roomId;
  b.db.mutes = b.db.mutes.filter((k) => k !== key);
  if (muted) b.db.mutes.push(key);
  b.emit({ type: 'rooms.changed' });
  return { roomId, rootId, muted };
}

function pinItem(
  b: MockBackend,
  targetType: PinItem['targetType'],
  targetId: string,
): Omit<PinItem, 'id' | 'position'> {
  if (targetType === 'room') {
    const room = roomOf(b, targetId);
    return {
      targetType,
      targetId,
      roomId: room.id,
      roomName: room.name,
      roomKind: room.kind,
      title: room.name,
      messageId: null,
      threadRootId: null,
    };
  }
  for (const room of b.db.rooms) {
    const list = all(b, room.id);
    const m = list.find((x) => x.id === targetId);
    if (!m) continue;
    const root = m.parentId ?? (targetType === 'thread' ? m.id : null);
    return {
      targetType,
      targetId: targetType === 'thread' ? (m.parentId ?? m.id) : m.id,
      roomId: room.id,
      roomName: room.name,
      roomKind: room.kind,
      title: m.threadTitle ?? preview(m.markdown),
      messageId: m.id,
      threadRootId: root,
    };
  }
  throw new HttpError(404, 'Pin target not found');
}

export function listPins(b: MockBackend): PinItem[] {
  return [...b.db.pins].sort((a, c) => a.position - c.position);
}

export function createPin(
  b: MockBackend,
  targetType: PinItem['targetType'],
  targetId: string,
): PinItem {
  const base = pinItem(b, targetType, targetId);
  const existing = b.db.pins.find(
    (p) => p.targetType === base.targetType && p.targetId === base.targetId,
  );
  if (existing) return existing;
  const pin: PinItem = { ...base, id: b.nextId('pin'), position: b.db.pins.length };
  b.db.pins.push(pin);
  b.emit({ type: 'pins.changed' });
  return pin;
}

export function deletePin(b: MockBackend, id: string) {
  b.db.pins = b.db.pins.filter((p) => p.id !== id);
  b.emit({ type: 'pins.changed' });
  return null;
}

export function mentionsFeed(
  b: MockBackend,
  before: number | undefined,
  limit: number,
): MentionFeedPage {
  const items = b.db.rooms
    .flatMap((room) =>
      all(b, room.id)
        .filter(
          (m) =>
            !m.deleted &&
            !isMine(b, m) &&
            mentionsMe(b, m) &&
            (before === undefined || (m.seq ?? 0) < before),
        )
        .map((m) => ({
          message: hydrate(b, m),
          roomId: room.id,
          roomName: room.name,
          roomKind: room.kind,
          threadRootId: m.parentId ?? null,
          threadTitle: all(b, room.id).find((x) => x.id === m.parentId)?.threadTitle ?? null,
        })),
    )
    .sort((a, c) => (c.message.seq ?? 0) - (a.message.seq ?? 0));
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

export const presence = (b: MockBackend): PresenceEntry[] => [
  { memberId: b.db.meId, status: 'online' },
];

// ---------- messages ----------

export function ensureDm(b: MockBackend, agentId: string): { chatId: string } {
  const agent = b.agent(agentId);
  if (!agent) throw new HttpError(404, 'Agent not found');
  const existing = b.db.rooms.find((r) => r.kind === 'dm' && r.agentId === agentId);
  if (existing) return { chatId: existing.id };
  const id = `dm-${agentId}`;
  b.db.rooms.unshift({
    id,
    kind: 'dm',
    name: agent.name,
    icon: 'users',
    isPrivate: true,
    agentId,
    lastMessageAt: iso(b.now()),
    preview: '',
    threads: [],
  });
  b.db.messages[id] = [];
  b.emit({ type: 'rooms.changed' });
  return { chatId: id };
}

function push(
  b: MockBackend,
  roomId: string,
  parentId: string | null,
  author: MessageAuthor,
  markdown: string,
  extra: Partial<Message> = {},
): Message {
  const list = all(b, roomId);
  const m: Message = {
    id: b.nextId('m'),
    chatId: parentId ?? roomOf(b, roomId).id,
    roomId,
    parentId,
    seq: lastSeq(list) + 1,
    author,
    createdAt: iso(b.now()),
    status: 'complete',
    markdown,
    assignment: null,
    draft: null,
    reactions: [],
    ...extra,
  };
  list.push(m);
  publish(b, m);
  return m;
}

/** Emits the message and, for a reply, the root's updated thread counters. */
function publish(b: MockBackend, m: Message) {
  b.emit({ type: 'message.upserted', message: hydrate(b, m) });
  if (m.parentId && m.roomId) {
    const list = all(b, m.roomId);
    const root = list.find((x) => x.id === m.parentId);
    const th = root && summaryOf(list, root);
    if (root && th)
      b.emit({
        type: 'thread.updated',
        roomId: m.roomId,
        rootId: root.id,
        title: th.title,
        replyCount: th.replyCount,
        lastReplyAt: th.lastReplyAt,
      });
  }
  b.emit({ type: 'rooms.changed' });
}

const MAX_WOKEN = 3;

export function sendRoomMessage(
  b: MockBackend,
  roomId: string,
  input: PostRoomMessageInput,
): Message {
  const room = roomOf(b, roomId);
  const text = input.markdown?.trim();
  if (!text) throw new HttpError(400, 'Message is empty');
  const list = all(b, roomId);
  if (input.clientMessageId) {
    const dup = list.find((m) => m.clientMessageId === input.clientMessageId && isMine(b, m));
    if (dup) return hydrate(b, dup);
  }
  const parent = input.parentId ? rootIdOf(list, input.parentId) : null;
  if (input.parentId && !parent) throw new HttpError(404, 'Message not found');
  if (input.threadTitle && parent) throw new HttpError(400, 'A reply cannot have a thread title');

  const roomAgents =
    room.kind === 'dm' ? [b.agent(room.agentId)].filter((a): a is Agent => !!a) : b.db.agents;
  if (room.kind === 'dm' && roomAgents[0] && !b.isOnline(roomAgents[0]))
    throw new HttpError(409, `${roomAgents[0].name} đang offline`);

  const quoted = input.quoteMessageId ? list.find((m) => m.id === input.quoteMessageId) : undefined;
  const m = push(b, roomId, parent, { kind: 'human', id: b.db.meId }, text, {
    threadTitle: input.threadTitle ?? null,
    clientMessageId: input.clientMessageId ?? null,
    quote: quoted
      ? {
          id: quoted.id,
          authorName:
            quoted.author.kind === 'external' ? quoted.author.name : b.nameOf(quoted.author.id),
          excerpt: quoted.deleted ? '' : preview(quoted.markdown).slice(0, 140),
        }
      : null,
  });

  const lower = text.toLowerCase();
  const mentioned = [...roomAgents]
    .sort((a, c) => c.name.length - a.name.length)
    .filter((a) => lower.includes('@' + a.name.toLowerCase()));
  const explicit = b.agent(input.agentId);
  const wanted = [
    ...(explicit ? [explicit] : []),
    ...mentioned.filter((a) => a.id !== explicit?.id),
    ...(room.kind === 'dm' && !explicit && !mentioned.length ? roomAgents : []),
  ];
  const woken = wanted.slice(0, MAX_WOKEN);
  const skipped = [
    ...wanted
      .slice(MAX_WOKEN)
      .map((a) => ({ agentId: a.id, name: a.name, reason: 'limit' as const })),
    ...woken
      .filter((a) => !b.isOnline(a))
      .map((a) => ({ agentId: a.id, name: a.name, reason: 'offline' as const })),
  ];
  // A channel mention answers in a thread under the message; everywhere else in place.
  const replyIn = parent ?? (room.kind === 'channel' ? m.id : null);
  for (const agent of woken.filter((a) => b.isOnline(a)))
    void runAssignment(b, roomId, replyIn, agent, text);
  const answer = hydrate(b, m);
  if (skipped.length) answer.skippedAgents = skipped;
  return answer;
}

export function editThreadTitle(
  b: MockBackend,
  roomId: string,
  rootId: string,
  title: string,
): Message {
  const root = all(b, roomId).find((m) => m.id === rootId && !m.parentId);
  if (!root) throw new HttpError(404, 'Thread not found');
  const t = title.trim();
  if (!t || t.length > 120) throw new HttpError(400, 'Invalid title');
  root.threadTitle = t;
  publish(b, root);
  const th = summaryOf(all(b, roomId), root);
  b.emit({
    type: 'thread.updated',
    roomId,
    rootId,
    title: t,
    replyCount: th?.replyCount ?? 0,
    lastReplyAt: th?.lastReplyAt ?? null,
  });
  return hydrate(b, root);
}

export function react(
  b: MockBackend,
  roomId: string,
  messageId: string,
  key: string,
  on: boolean,
): Message {
  const m = all(b, roomId).find((x) => x.id === messageId);
  if (!m || m.deleted) throw new HttpError(404, 'Message not found');
  const reactions: MessageReaction[] = (m.reactions ??= []);
  let r = reactions.find((x) => x.key === key);
  if (on) {
    if (!r) reactions.push((r = { key, count: 0, memberIds: [] }));
    if (!r.memberIds.includes(b.db.meId)) {
      r.memberIds.push(b.db.meId);
      r.count++;
    }
  } else if (r?.memberIds.includes(b.db.meId)) {
    r.memberIds = r.memberIds.filter((x) => x !== b.db.meId);
    r.count--;
    if (r.count <= 0) m.reactions = reactions.filter((x) => x.key !== key);
  }
  b.emit({
    type: 'message.reactions_updated',
    roomId,
    messageId,
    parentId: m.parentId ?? null,
    reactions: structuredClone(m.reactions ?? []).map(({ mine: _mine, ...rest }) => rest),
  });
  return hydrate(b, m);
}

function replyFor(text: string) {
  if (/sort|hàm|code|function/i.test(text))
    return 'Em viết hàm sort ổn định theo nhiều khoá, có test kèm theo:\n\n```ts\nexport function sortBy<T>(items: T[], ...keys: ((x: T) => string | number)[]) {\n  return [...items].sort((a, b) => {\n    for (const k of keys) {\n      const d = k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;\n      if (d) return d;\n    }\n    return 0;\n  });\n}\n```\n\nĐã chạy `pnpm test`: **4/4 pass**. Anh/chị muốn em commit vào nhánh mới không?';
  return 'Em đã xem qua repo và lịch sử gần đây. Tóm tắt nhanh:\n\n1. **apps/fe** là Tauri 2 + React 19, đã có UI workspace chạy trên mock.\n2. **apps/be** là NestJS 12 + TypeORM 1, healthcheck chạy ổn.\n3. Chưa có commit nào trên `main`.\n\nBước tiếp theo em đề xuất là làm API thật cho rooms và tasks. Anh/chị muốn em bắt đầu luôn không?';
}

/**
 * Mock assignment lifecycle: pending → offered → claimed → running, a couple of tool calls,
 * then the reply streams in small chunks and completes (or fails now and then). The reply goes
 * to `parentId` (a thread) or the room's main timeline.
 */
export async function runAssignment(
  b: MockBackend,
  roomId: string,
  parentId: string | null,
  agent: Agent,
  text: string,
) {
  const startedAt = b.now();
  const m = push(b, roomId, parentId, { kind: 'agent', id: agent.id }, '', {
    status: 'streaming',
    phase: 'queued',
    startedAt: null,
    workedMs: null,
    assignment: {
      id: b.nextId('as'),
      agentId: agent.id,
      status: 'pending',
      toolCalls: [],
      turns: 0,
      costUsd: null,
      error: null,
    },
  });
  const a = m.assignment!;
  const update = () => publish(b, m);
  /** The agent was deleted mid-reply: the open reply is cancelled and its message fails. */
  const cancelled = () => {
    if (b.agent(agent.id)) return false;
    a.status = 'cancelled';
    a.error = 'Agent đã bị xoá';
    m.status = 'failed';
    m.phase = 'failed';
    update();
    b.chatBusy.delete(agent.id);
    return true;
  };

  const halted = () => {
    if (m.status === 'stopped') {
      b.chatBusy.delete(agent.id);
      return true;
    }
    return cancelled();
  };

  for (const s of ['offered', 'claimed', 'running'] as const) {
    await sleep(b, 450);
    if (halted()) return;
    a.status = s;
    if (s === 'running') {
      m.phase = 'thinking';
      m.startedAt = iso(b.now());
    }
    update();
  }
  b.chatBusy.add(agent.id);
  b.changed();

  const coding = /sort|hàm|code|function/i.test(text);
  const calls: [string, string, string][] = coding
    ? [
        ['Write', 'src/utils/sortBy.ts', 'Wrote 11 lines'],
        [
          'Bash',
          'pnpm test -- sortBy',
          '✓ sortBy › single key\n✓ sortBy › multi key\n✓ sortBy › stable\n✓ sortBy › empty\nTests: 4 passed',
        ],
      ]
    : [
        ['Bash', 'git log --oneline -5', '(no commits yet)'],
        ['Read', 'apps/fe/package.json', '"react": "^19.3.1", "vite": "^8.3.4" …'],
      ];
  for (const [name, input, output] of calls) {
    const call: ToolCall = { id: b.nextId('tc'), name, input, output, status: 'running' };
    a.toolCalls.push(call);
    m.phase = 'tool';
    m.activeTool = name;
    update();
    await sleep(b, 900);
    if (halted()) return;
    call.status = 'ok';
    update();
  }

  m.activeTool = null;
  const failed = b.random() < 0.08;
  if (failed) {
    a.status = 'failed';
    a.error = 'Claude Code thoát với mã 1 (context quá dài)';
    m.status = 'failed';
    m.phase = 'failed';
  } else {
    const full = replyFor(text);
    let shown = 0;
    m.phase = 'writing';
    while (shown < full.length) {
      shown = Math.min(full.length, shown + 3 + Math.floor(b.random() * 6));
      m.markdown = full.slice(0, shown);
      update();
      await sleep(b, 28);
      if (halted()) return;
    }
    a.status = 'completed';
    a.turns = 2;
    m.status = 'complete';
    m.phase = 'done';
  }
  m.workedMs = b.now() - startedAt;
  update();
  b.chatBusy.delete(agent.id);
  b.countRun(agent.id, !failed, 4);
  b.feed(
    agent.id,
    failed ? `thất bại khi trả lời **${preview(text)}**` : `trả lời **${preview(text)}**`,
  );
  const room = roomOf(b, roomId);
  const root = parentId ? all(b, roomId).find((x) => x.id === parentId) : undefined;
  b.db.agentActivity[agent.id]?.unshift({
    id: b.nextId('aa'),
    where:
      room.kind === 'dm'
        ? 'DM'
        : `#${room.name}${root ? ` › ${root.threadTitle ?? preview(root.markdown)}` : ''}`,
    request: preview(text),
    status: failed ? 'failed' : 'completed',
    at: iso(b.now()),
  });
  b.changed();
  b.emit({ type: 'rooms.changed' });
}

/** Legacy chat ids (a DM room or a thread root) to where messages go. */
export function resolveChat(
  b: MockBackend,
  chatId: string,
): { roomId: string; parentId: string | null } {
  if (b.db.rooms.some((r) => r.id === chatId)) return { roomId: chatId, parentId: null };
  for (const [roomId, list] of Object.entries(b.db.messages))
    if (list.some((m) => m.id === chatId)) return { roomId, parentId: chatId };
  throw new HttpError(404, `Chat ${chatId} not found`);
}

const SAMPLES: Record<string, { from: string; text: string; reply: string }> = {
  zalo: {
    from: 'Nguyễn Lan',
    text: 'Shop ơi áo polo size M còn màu trắng không ạ? Ship về Đà Nẵng mất mấy ngày?',
    reply:
      'Dạ chào chị Lan, áo polo size M màu trắng bên em **còn 6 chiếc** ạ. Ship về Đà Nẵng khoảng **2–3 ngày**, đơn từ 300k được miễn phí ship. Chị muốn em giữ hàng luôn không ạ?',
  },
  facebook: {
    from: 'Trần Huy',
    text: 'Cho mình hỏi gói Pro giá bao nhiêu, có dùng thử không?',
    reply:
      'Chào anh Huy, gói Pro là **$20/tháng** và có **14 ngày dùng thử miễn phí**, không cần thẻ. Em gửi anh link đăng ký nhé?',
  },
  gmail: {
    from: 'Phòng kế toán',
    text: '**Re: Hoá đơn tháng 9**\nAnh gửi giúp em bản xác nhận thanh toán AWS tháng 9 trước thứ Sáu nhé.',
    reply:
      'Em đã tìm thấy email hoá đơn AWS tháng 9 (**$412,80**) và soạn nháp trả lời kèm file PDF. Anh xem rồi bấm gửi giúp em.',
  },
};

function connection(b: MockBackend, id: string) {
  const c = b.db.connections.find((x) => x.id === id);
  if (!c) throw new HttpError(404, `Connection ${id} not found`);
  return c;
}

export function connect(b: MockBackend, id: string, input: ConnectInput) {
  const c = connection(b, id);
  if (!b.agent(input.agentId)) throw new HttpError(400, 'Unknown agent');
  const wasOn = c.status === 'on';
  c.status = 'on';
  c.account = input.account;
  c.agentId = input.agentId;
  c.mode = input.mode;
  c.roomName = input.roomName.trim().replace(/^#/, '') || `${c.id}-inbox`;
  const roomId = `${c.id}-room`;
  const threadId = `t-${c.id}`;
  const sample = SAMPLES[c.id]!;
  const existing = b.db.rooms.find((r) => r.id === roomId);
  if (existing) existing.name = c.roomName;
  else
    b.db.rooms.push({
      id: roomId,
      kind: 'channel',
      name: c.roomName,
      icon: 'inbox',
      isPrivate: false,
      agentId: null,
      lastMessageAt: iso(b.now()),
      preview: '',
      threads: [],
    });
  c.roomId = roomId;
  if (!wasOn) {
    b.db.messages[roomId] = [];
    // The conversation is a titled root (the sender) with the agent's draft as its reply.
    push(
      b,
      roomId,
      null,
      { kind: 'external', connectionId: c.id, name: sample.from },
      sample.text,
      { threadTitle: sample.from, id: threadId },
    );
    push(b, roomId, threadId, { kind: 'agent', id: input.agentId }, sample.reply, {
      draft: { connectionId: c.id, state: c.mode === 'draft' ? 'pending' : 'sent' },
    });
    b.feed(b.db.meId, `kết nối **${c.name}** vào **#${c.roomName}**`);
  }
  b.emit({ type: 'connections.changed' });
  b.emit({ type: 'rooms.changed' });
  return c;
}

export function disconnect(b: MockBackend, id: string) {
  const c = connection(b, id);
  c.status = 'off';
  b.db.rooms = b.db.rooms.filter((r) => r.id !== c.roomId);
  delete b.db.messages[c.roomId ?? ''];
  c.roomId = null;
  c.account = null;
  b.emit({ type: 'connections.changed' });
  b.emit({ type: 'rooms.changed' });
  return c;
}

export function sendDraft(b: MockBackend, messageId: string) {
  for (const list of Object.values(b.db.messages)) {
    const m = list.find((x) => x.id === messageId);
    if (m?.draft) {
      m.draft.state = 'sent';
      publish(b, m);
      return hydrate(b, m);
    }
  }
  throw new HttpError(404, 'Draft not found');
}

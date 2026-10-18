import type { Message, MessageReaction, ReadState, Room, RealtimeEvent } from '@repo/shared';
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '../../lib/query-keys';
import { scopeKey, useChatStore, type LocalMessage, type OutboxItem } from '../../stores/chat';
import {
  authorId,
  mapThread,
  mapTimeline,
  mergeReactions,
  patchRoom,
  patchRoomThread,
  upsertThread,
  upsertTimeline,
  withParticipant,
  type ThreadData,
  type TimelineData,
} from './chat.cache';

const FINAL_PHASES = new Set(['done', 'failed', 'stopped']);

/** An outbox item shaped like a message, for the timeline. */
export function outboxToMessage(o: OutboxItem): LocalMessage {
  return {
    id: `local-${o.clientMessageId}`,
    chatId: o.roomId,
    roomId: o.roomId,
    parentId: o.parentId,
    author: { kind: 'human', id: o.authorId },
    createdAt: o.createdAt,
    status: 'complete',
    markdown: o.markdown,
    assignment: null,
    draft: null,
    quote: o.quote ?? null,
    threadTitle: o.threadTitle ?? null,
    clientMessageId: o.clientMessageId,
    reactions: [],
    local: o.status,
    localError: o.error,
  };
}

/** Puts a message (from a REST answer or an event) into every cache that shows it. */
export function applyMessage(qc: QueryClient, m: Message, me: string | undefined): void {
  const roomId = m.roomId;
  if (!roomId) return;
  if (m.clientMessageId && m.author.kind === 'human' && m.author.id === me)
    useChatStore.getState().removeOutbox(m.clientMessageId);

  if (!m.parentId) {
    qc.setQueryData<TimelineData>(qk.timeline(roomId), (d) => upsertTimeline(d, m));
    // A root can be the open thread's root (edit, delete, summary).
    qc.setQueryData<ThreadData>(qk.thread(roomId, m.id), (d) => upsertThread(d, m));
  } else {
    qc.setQueryData<ThreadData>(qk.thread(roomId, m.parentId), (d) => upsertThread(d, m));
    const aid = authorId(m);
    if (aid)
      qc.setQueryData<TimelineData>(qk.timeline(roomId), (d) =>
        mapTimeline(d, (x) => (x.id === m.parentId ? withParticipant(x, aid) : x)),
      );
  }

  if (m.author.kind === 'agent' && m.phase) {
    const agentId = m.author.id;
    const working = !FINAL_PHASES.has(m.phase);
    qc.setQueryData<Room[]>(qk.rooms, (rooms) => {
      const room = rooms?.find((r) => r.id === roomId);
      if (!room) return rooms;
      const cur = room.workingAgentIds ?? [];
      if (working === cur.includes(agentId)) return rooms;
      return patchRoom(rooms, roomId, {
        workingAgentIds: working ? [...cur, agentId] : cur.filter((x) => x !== agentId),
      });
    });
  }
}

export function applyThreadUpdated(
  qc: QueryClient,
  e: Extract<RealtimeEvent, { type: 'thread.updated' }>,
): void {
  const patch = (x: Message): Message =>
    x.id === e.rootId
      ? {
          ...x,
          threadTitle: e.title,
          thread: {
            participantIds: x.thread?.participantIds ?? [],
            title: e.title,
            replyCount: e.replyCount,
            lastReplyAt: e.lastReplyAt,
          },
        }
      : x;
  qc.setQueryData<TimelineData>(qk.timeline(e.roomId), (d) => mapTimeline(d, patch));
  qc.setQueryData<ThreadData>(qk.thread(e.roomId, e.rootId), (d) => mapThread(d, patch));
  qc.setQueryData<Room[]>(qk.rooms, (rooms) =>
    patchRoomThread(rooms, e.roomId, e.rootId, {
      ...(e.title ? { name: e.title } : null),
      replyCount: e.replyCount,
      lastReplyAt: e.lastReplyAt,
    }),
  );
}

export function applyReactions(
  qc: QueryClient,
  roomId: string,
  messageId: string,
  parentId: string | null,
  reactions: MessageReaction[],
  me: string | undefined,
): void {
  const patch = (x: Message): Message =>
    x.id === messageId ? { ...x, reactions: mergeReactions(x.reactions, reactions, me) } : x;
  if (!parentId || parentId === messageId)
    qc.setQueryData<TimelineData>(qk.timeline(roomId), (d) => mapTimeline(d, patch));
  qc.setQueryData<ThreadData>(qk.thread(roomId, parentId ?? messageId), (d) => mapThread(d, patch));
}

/** The REST answer of a reaction toggle is authoritative for the caller's own `mine`. */
export function applyReactionAnswer(qc: QueryClient, m: Message): void {
  if (!m.roomId) return;
  const patch = (x: Message): Message =>
    x.id === m.id ? { ...x, reactions: m.reactions ?? [] } : x;
  qc.setQueryData<TimelineData>(qk.timeline(m.roomId), (d) => mapTimeline(d, patch));
  qc.setQueryData<ThreadData>(qk.thread(m.roomId, m.parentId ?? m.id), (d) => mapThread(d, patch));
}

/** A read cursor moved: update the counts of the room or thread in the rooms list. */
export function applyReadState(qc: QueryClient, s: ReadState): void {
  qc.setQueryData<Room[]>(qk.rooms, (rooms) =>
    s.rootId
      ? patchRoomThread(rooms, s.roomId, s.rootId, {
          unread: s.unread,
          mentions: s.mentions,
          lastReadSeq: s.lastReadSeq,
        })
      : patchRoom(rooms, s.roomId, {
          unread: s.unread,
          mentions: s.mentions,
          lastReadSeq: s.lastReadSeq,
        }),
  );
}

/** Refetches the open timelines and threads (after an SSE reconnect). */
export function resyncOpenChats(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['room-timeline'] });
  void qc.invalidateQueries({ queryKey: ['room-thread'] });
  void qc.invalidateQueries({ queryKey: qk.pins });
  void qc.invalidateQueries({ queryKey: qk.presence });
}

export { scopeKey };

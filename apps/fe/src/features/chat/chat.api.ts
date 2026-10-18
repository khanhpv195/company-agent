import type {
  AddRoomMembersInput,
  BrowseRoom,
  CreateRoomInput,
  Message,
  MentionFeedPage,
  MuteState,
  PinItem,
  PostRoomMessageInput,
  PresenceEntry,
  ReadState,
  Room,
  RoomMembers,
  RoomTimelinePage,
  Thread,
  ThreadFilter,
  ThreadPage,
  UpdateRoomInput,
} from '@repo/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { api, toSearchParams } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { scopeKey, useChatStore } from '../../stores/chat';
import { translate } from '../../i18n';
import { useSession } from '../workspace/workspace.api';
import { type ThreadData, type TimelineData } from './chat.cache';
import { applyMessage, applyReactionAnswer, applyReadState } from './chat.sync';

export const TIMELINE_PAGE = 50;
export const THREAD_PAGE = 100;

export const useRooms = () =>
  useQuery({ queryKey: qk.rooms, queryFn: () => api.get<Room[]>('/rooms') }).data ?? [];

/** The rooms query itself, for callers that need to know whether the first answer arrived. */
export const useRoomsQuery = () =>
  useQuery({ queryKey: qk.rooms, queryFn: () => api.get<Room[]>('/rooms') });

/** Main timeline of a room, newest page first; `fetchNextPage` loads older messages. */
export const useRoomTimeline = (roomId: string) =>
  useInfiniteQuery({
    queryKey: qk.timeline(roomId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.get<RoomTimelinePage>(
        `/rooms/${roomId}/messages${toSearchParams({ beforeSeq: pageParam, limit: TIMELINE_PAGE })}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.seq : undefined),
    staleTime: Infinity,
  });

/** A thread: the root and its replies, oldest first; `fetchNextPage` loads newer replies. */
export const useThread = (roomId: string, rootId: string | undefined) =>
  useInfiniteQuery({
    queryKey: qk.thread(roomId, rootId ?? ''),
    enabled: !!rootId,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.get<ThreadPage>(
        `/rooms/${roomId}/messages/${rootId}/thread${toSearchParams({ afterSeq: pageParam, limit: THREAD_PAGE })}`,
      ),
    getNextPageParam: (last) =>
      last.hasMore ? (last.replies[last.replies.length - 1]?.seq ?? undefined) : undefined,
    staleTime: Infinity,
  });

export const useRoomMembers = (roomId: string) =>
  useQuery({
    queryKey: qk.roomMembers(roomId),
    queryFn: () => api.get<RoomMembers>(`/rooms/${roomId}/members`),
  });

export const useRoomThreads = (roomId: string, filter: ThreadFilter = 'all') =>
  useQuery({
    queryKey: qk.roomThreads(roomId, filter),
    queryFn: () => api.get<Thread[]>(`/rooms/${roomId}/threads${toSearchParams({ filter })}`),
  });

export const usePins = () =>
  useQuery({ queryKey: qk.pins, queryFn: () => api.get<PinItem[]>('/pins') }).data ?? [];

export const MENTIONS_PAGE = 30;
export const useMentionsFeed = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: qk.mentions,
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.get<MentionFeedPage>(
        `/mentions${toSearchParams({ limit: MENTIONS_PAGE, before: pageParam })}`,
      ),
    getNextPageParam: (last) =>
      last.hasMore ? (last.items[last.items.length - 1]?.message.seq ?? undefined) : undefined,
  });

export const usePresence = () =>
  useQuery({
    queryKey: qk.presence,
    queryFn: () => api.get<PresenceEntry[]>('/presence'),
  }).data ?? [];

// ---------- sending ----------

export interface SendInput {
  roomId: string;
  markdown: string;
  parentId?: string | null;
  threadTitle?: string;
  quoteMessageId?: string;
  /** Shown on the optimistic message until the server answer arrives. */
  quote?: Message['quote'];
  agentId?: string;
  /** Reuse the key of a failed send to retry it. */
  clientMessageId?: string;
}

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const errorText = (e: unknown) => (e instanceof Error ? e.message : translate('chat.sendFailed'));

async function post(qc: QueryClient, me: string | undefined, cid: string): Promise<Message | null> {
  const store = useChatStore.getState();
  const item = store.outbox.find((o) => o.clientMessageId === cid);
  if (!item) return null;
  store.patchOutbox(cid, { status: 'sending', error: undefined });
  const body: PostRoomMessageInput = {
    markdown: item.markdown,
    clientMessageId: cid,
    ...(item.parentId ? { parentId: item.parentId } : null),
    ...(item.threadTitle ? { threadTitle: item.threadTitle } : null),
    ...(item.quoteMessageId ? { quoteMessageId: item.quoteMessageId } : null),
  };
  try {
    const m = await api.post<Message>(`/rooms/${item.roomId}/messages`, body);
    applyMessage(qc, m, me);
    useChatStore.getState().removeOutbox(cid);
    const skipped = m.skippedAgents ?? [];
    useChatStore.getState().setNotice(
      scopeKey(item.roomId, item.parentId),
      skipped.map((s) => translate(`chat.skipped.${s.reason}`, { name: s.name })),
    );
    return m;
  } catch (e) {
    useChatStore.getState().patchOutbox(cid, { status: 'failed', error: errorText(e) });
    return null;
  }
}

/** Optimistic send: the message shows at once, then settles or fails (and can be retried). */
export function useSendMessage() {
  const qc = useQueryClient();
  const me = useSession().data?.user.id;
  const send = useCallback(
    (input: SendInput) => {
      const cid = input.clientMessageId ?? newClientId();
      useChatStore.getState().addOutbox({
        clientMessageId: cid,
        roomId: input.roomId,
        parentId: input.parentId ?? null,
        threadTitle: input.threadTitle,
        quoteMessageId: input.quoteMessageId,
        quote: input.quote,
        markdown: input.markdown,
        authorId: me ?? '',
        createdAt: new Date().toISOString(),
        status: 'sending',
      });
      useChatStore.getState().setNotice(scopeKey(input.roomId, input.parentId), []);
      return post(qc, me, cid);
    },
    [qc, me],
  );
  const retry = useCallback((cid: string) => post(qc, me, cid), [qc, me]);
  const discard = useCallback((cid: string) => useChatStore.getState().removeOutbox(cid), []);
  return { send, retry, discard };
}

export const useSendDraft = () =>
  useMutation({
    mutationFn: (messageId: string) => api.post<Message>(`/messages/${messageId}/send-draft`),
  });

// ---------- read state ----------

/**
 * Posts the read cursor of a room (or thread) once the window is visible and a newer message than
 * the cursor is on screen. `seq` is the highest seq shown, `current` the cursor the server holds.
 */
export function useReadCursor(opts: {
  roomId: string;
  rootId?: string | null;
  seq: number;
  current: number;
  enabled: boolean;
}) {
  const qc = useQueryClient();
  const { roomId, rootId, seq, current, enabled } = opts;
  const posted = useRef(0);
  useEffect(() => {
    posted.current = 0;
  }, [roomId, rootId]);
  useEffect(() => {
    if (!enabled || seq <= Math.max(current, posted.current)) return;
    const fire = () => {
      if (document.visibilityState !== 'visible' || seq <= posted.current) return;
      const before = posted.current;
      posted.current = seq;
      const path = rootId ? `/rooms/${roomId}/threads/${rootId}/read` : `/rooms/${roomId}/read`;
      api
        .post<ReadState>(path, { seq })
        .then((s) => applyReadState(qc, s))
        .catch(() => {
          posted.current = before;
        });
    };
    const timer = setTimeout(fire, 500);
    document.addEventListener('visibilitychange', fire);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', fire);
    };
  }, [qc, roomId, rootId, seq, current, enabled]);
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/rooms/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.rooms });
      void qc.invalidateQueries({ queryKey: qk.mentions });
    },
  });
}

// ---------- room state ----------

export function useToggleMute(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mute: boolean) =>
      mute
        ? api.post<MuteState>(`/rooms/${roomId}/mute`)
        : api.delete<MuteState>(`/rooms/${roomId}/mute`),
    onSuccess: (s) =>
      qc.setQueryData<Room[]>(qk.rooms, (rooms) =>
        rooms?.map((r) => (r.id === roomId ? { ...r, muted: s.muted } : r)),
      ),
  });
}

export function useTogglePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (target: {
      pinId?: string;
      targetType: 'room' | 'thread' | 'message';
      targetId: string;
    }) =>
      target.pinId
        ? api.delete(`/pins/${target.pinId}`)
        : api.post<PinItem>('/pins', { targetType: target.targetType, targetId: target.targetId }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.pins }),
  });
}

export function useRenameThread(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rootId, title }: { rootId: string; title: string }) =>
      api.patch<Message>(`/rooms/${roomId}/messages/${rootId}/thread`, { title }),
    onSuccess: (m) => applyMessage(qc, m, undefined),
  });
}

export function useToggleReaction(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, key }: { message: Message; key: string }) => {
      const mine = message.reactions?.find((r) => r.key === key)?.mine;
      const path = `/rooms/${roomId}/messages/${message.id}/reactions/${encodeURIComponent(key)}`;
      return mine ? api.delete<Message>(path) : api.put<Message>(path);
    },
    onSuccess: (m) => applyReactionAnswer(qc, m),
  });
}

/** Tells the room someone is typing (the server throttles; this also limits requests). */
export function useTypingPing(roomId: string, parentId?: string | null) {
  const last = useRef(0);
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < 2_000) return;
    last.current = now;
    void api.post(`/rooms/${roomId}/typing`, parentId ? { parentId } : {}).catch(() => {});
  }, [roomId, parentId]);
}

/** Opens (or creates) the DM room with an agent. Rooms are refetched so the DM shows in the sidebar. */
export function useOpenDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ chatId: string }>(`/agents/${agentId}/dm`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.rooms }),
  });
}

export function useEditMessage(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, markdown }: { messageId: string; markdown: string }) =>
      api.patch<Message>(`/rooms/${roomId}/messages/${messageId}`, { markdown }),
    onSuccess: (m) => applyMessage(qc, m, undefined),
  });
}

export function useDeleteMessage(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.delete<Message>(`/rooms/${roomId}/messages/${messageId}`),
    onSuccess: (m) => applyMessage(qc, m, undefined),
  });
}

export function useStopAgent(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.post<Message>(`/rooms/${roomId}/messages/${messageId}/stop`),
    onSuccess: (m) => applyMessage(qc, m, undefined),
  });
}

export function useMarkUnread(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rootId, throughSeq }: { rootId?: string | null; throughSeq: number }) => {
      const path = rootId ? `/rooms/${roomId}/threads/${rootId}/unread` : `/rooms/${roomId}/unread`;
      return api.post<ReadState>(path, { throughSeq });
    },
    onSuccess: (s) => applyReadState(qc, s),
  });
}

export function useToggleThreadMute(roomId: string, rootId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mute: boolean) =>
      mute
        ? api.post<MuteState>(`/rooms/${roomId}/threads/${rootId}/mute`)
        : api.delete<MuteState>(`/rooms/${roomId}/threads/${rootId}/mute`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.rooms }),
  });
}

const refreshRooms = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: qk.rooms });
};

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => api.post<Room>('/rooms', input),
    onSuccess: () => refreshRooms(qc),
  });
}

export function useUpdateRoom(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoomInput) => api.patch<Room>(`/rooms/${roomId}`, input),
    onSuccess: () => refreshRooms(qc),
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.delete(`/rooms/${roomId}`),
    onSuccess: () => refreshRooms(qc),
  });
}

export function useLeaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.post(`/rooms/${roomId}/leave`),
    onSuccess: () => refreshRooms(qc),
  });
}

export function useJoinRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.post<Room>(`/rooms/${roomId}/join`),
    onSuccess: () => refreshRooms(qc),
  });
}

export function useBrowseRooms(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.rooms, 'browse'] as const,
    queryFn: () => api.get<BrowseRoom[]>('/rooms/browse'),
    enabled,
  });
}

export function useAddRoomMembers(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddRoomMembersInput) =>
      api.post<RoomMembers>(`/rooms/${roomId}/members`, input),
    onSuccess: (data) => {
      qc.setQueryData(qk.roomMembers(roomId), data);
      refreshRooms(qc);
    },
  });
}

export function useRemoveRoomMember(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, targetId }: { kind: 'member' | 'agent'; targetId: string }) =>
      api.delete<RoomMembers>(`/rooms/${roomId}/members/${kind}/${targetId}`),
    onSuccess: (data) => {
      qc.setQueryData(qk.roomMembers(roomId), data);
      refreshRooms(qc);
    },
  });
}

export type { ThreadData, TimelineData };

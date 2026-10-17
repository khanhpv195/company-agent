import type { Chat, Message, Room } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const useRooms = () =>
  useQuery({ queryKey: qk.rooms, queryFn: () => api.get<Room[]>('/rooms') }).data ?? [];
export const useChat = (id: string) =>
  useQuery({ queryKey: qk.chat(id), queryFn: () => api.get<Chat>(`/chats/${id}`) });
export const useMessages = (id: string) =>
  useQuery({
    queryKey: qk.messages(id),
    queryFn: () => api.get<Message[]>(`/chats/${id}/messages`),
    staleTime: Infinity,
  });

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (markdown: string) => api.post<Message>(`/chats/${chatId}/messages`, { markdown }),
    // The message also arrives as a realtime event; this covers non-push transports.
    onSuccess: (m) =>
      qc.setQueryData<Message[]>(qk.messages(chatId), (old) =>
        !old || old.some((x) => x.id === m.id) ? old : [...old, m],
      ),
  });
}

export const useSendDraft = () =>
  useMutation({
    mutationFn: (messageId: string) => api.post<Message>(`/messages/${messageId}/send-draft`),
  });

export const useMarkRead = () =>
  useMutation({ mutationFn: (chatId: string) => api.post(`/chats/${chatId}/read`) });

/** Opens (or creates) the DM room with an agent. Rooms are refetched so the DM shows in the sidebar. */
export function useOpenDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ chatId: string }>(`/agents/${agentId}/dm`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.rooms }),
  });
}

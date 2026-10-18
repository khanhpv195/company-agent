import type { MessageQuote, Room } from '@repo/shared';
import { createContext, useContext } from 'react';
import type { LocalMessage } from '../../stores/chat';

export interface ChatScopeValue {
  roomId: string;
  parentId: string | null;
  me?: string;
  myRoomRole: Room['myRole'];
  workspaceRole?: string;
  quote: MessageQuote | null;
  setQuote: (quote: MessageQuote | null) => void;
  editingId: string | null;
  startEdit: (id: string) => void;
  cancelEdit: () => void;
  saveEdit: (messageId: string, markdown: string) => Promise<void>;
  editError?: string;
  editLast: () => void;
  retryAgent: (message: LocalMessage) => void;
}

export const ChatScopeContext = createContext<ChatScopeValue | null>(null);

export function useChatScope() {
  return useContext(ChatScopeContext);
}

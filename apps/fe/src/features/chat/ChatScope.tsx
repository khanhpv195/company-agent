import type { Room } from '@repo/shared';
import { useMemo, useState, type ReactNode } from 'react';
import type { LocalMessage } from '../../stores/chat';
import { useSession } from '../workspace/workspace.api';
import { useEditMessage, useSendMessage } from './chat.api';
import { ChatScopeContext, type ChatScopeValue } from './chat-scope';

/**
 * Quote, inline edit and "edit my last message" for one composer and the timeline above it.
 * A room and its open thread each get their own scope.
 */
export function ChatScope({
  roomId,
  parentId = null,
  myRoomRole = null,
  messages,
  children,
}: {
  roomId: string;
  parentId?: string | null;
  myRoomRole?: Room['myRole'];
  messages: LocalMessage[];
  children: ReactNode;
}) {
  const session = useSession().data?.user;
  const me = session?.id;
  const edit = useEditMessage(roomId);
  const sender = useSendMessage();
  const [quote, setQuote] = useState<MessageQuote | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const value = useMemo<ChatScopeValue>(() => {
    const editLast = () => {
      const mine = [...messages]
        .reverse()
        .find((m) => m.author.kind === 'human' && m.author.id === me && !m.deleted && !m.local);
      if (mine) setEditingId(mine.id);
    };
    return {
      roomId,
      parentId,
      me,
      myRoomRole,
      workspaceRole: session?.role,
      quote,
      setQuote,
      editingId,
      startEdit: setEditingId,
      cancelEdit: () => setEditingId(null),
      saveEdit: async (messageId, markdown) => {
        await edit.mutateAsync({ messageId, markdown });
        setEditingId(null);
      },
      editError: edit.error instanceof Error ? edit.error.message : undefined,
      editLast,
      retryAgent: (message) => {
        const idx = messages.findIndex((m) => m.id === message.id);
        const trigger = messages
          .slice(0, idx)
          .reverse()
          .find((m) => m.author.kind === 'human' && m.markdown && !m.deleted);
        if (!trigger) return;
        void sender.send({
          roomId,
          parentId: message.parentId ?? parentId,
          markdown: trigger.markdown,
        });
      },
    };
  }, [roomId, parentId, me, myRoomRole, session?.role, quote, editingId, edit, messages, sender]);

  return <ChatScopeContext.Provider value={value}>{children}</ChatScopeContext.Provider>;
}

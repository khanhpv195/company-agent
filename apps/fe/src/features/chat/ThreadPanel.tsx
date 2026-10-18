import type { Agent, Member, Room } from '@repo/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { scopeKey, useChatStore } from '../../stores/chat';
import { useMembers, useSession } from '../workspace/workspace.api';
import {
  usePins,
  useReadCursor,
  useRenameThread,
  useSendMessage,
  useThread,
  useTogglePin,
  useToggleThreadMute,
  useTypingPing,
} from './chat.api';
import { flattenThread, mergeOutbox } from './chat.cache';
import { canRenameThread, threadLabel } from './chat.logic';
import { maxSeq } from './chat.timeline';
import { outboxToMessage } from './chat.sync';
import { ChatScope } from './ChatScope';
import { Composer } from './Composer';
import { Timeline } from './Timeline';
import { TypingLine } from './TypingLine';

const TITLE_MAX = 120;

/** Right-hand panel: a thread's root, replies, title (renamable) and its own composer. */
export function ThreadPanel({
  room,
  rootId,
  agents,
  members,
  targetId,
  onClose,
}: {
  room: Room;
  rootId: string;
  agents: Agent[];
  members: Member[];
  targetId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const session = useSession().data?.user;
  const others = useMembers().filter(
    (m) => m.id !== session?.id && !members.some((x) => x.id === m.id),
  );
  const query = useThread(room.id, rootId);
  const { root, replies, hasMore } = useMemo(() => flattenThread(query.data), [query.data]);
  const outbox = useChatStore((s) => s.outbox);
  const notice = useChatStore((s) => s.notices[scopeKey(room.id, rootId)]);
  const sender = useSendMessage();
  const ping = useTypingPing(room.id, rootId);
  const rename = useRenameThread(room.id);
  const pins = usePins();
  const togglePin = useTogglePin();
  const threadMute = useToggleThreadMute(room.id, rootId);
  const summary = room.threads.find((x) => x.id === rootId);
  const threadPin = pins.find((p) => p.targetType === 'thread' && p.targetId === rootId);
  const panel = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const [openRead] = useState(() => summary?.lastReadSeq ?? 0);

  const server = useMemo(() => (root ? [root, ...replies] : []), [root, replies]);
  const messages = useMemo(
    () => mergeOutbox(server, outbox, room.id, rootId, outboxToMessage),
    [server, outbox, room.id, rootId],
  );

  useReadCursor({
    roomId: room.id,
    rootId,
    seq: maxSeq(server),
    current: summary?.lastReadSeq ?? 0,
    enabled: query.isSuccess,
  });

  // Esc closes the panel unless something else (a popover) already handled it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]'))
        onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = threadLabel(root?.thread?.title ?? root?.threadTitle, root?.markdown);
  const canRename =
    !!root &&
    canRenameThread({
      me: session?.id,
      rootAuthorId: root.author.kind === 'human' ? root.author.id : null,
      myRoomRole: room.myRole,
      workspaceRole: session?.role,
    });
  const commit = () => {
    const next = (editing ?? '').trim();
    setEditing(null);
    if (next && next !== title) rename.mutate({ rootId, title: next });
  };

  return (
    <aside className="thread-panel" aria-label={t('chat.thread.title')} ref={panel}>
      <div className="thread-head">
        <Icon name="thread" size={16} />
        {editing !== null ? (
          <input
            className="thread-title-input"
            autoFocus
            value={editing}
            maxLength={TITLE_MAX}
            aria-label={t('chat.thread.rename')}
            onChange={(e) => setEditing(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditing(null);
              }
            }}
          />
        ) : canRename ? (
          <button
            type="button"
            className="thread-title"
            title={t('chat.thread.rename')}
            onClick={() => setEditing(title)}
          >
            {title || t('chat.thread.untitled')}
          </button>
        ) : (
          <span className="thread-title static">{title || t('chat.thread.untitled')}</span>
        )}
        {rename.error && <span className="err-line inline">{rename.error.message}</span>}
        <button
          type="button"
          className="icon-btn"
          aria-pressed={!!summary?.muted}
          title={summary?.muted ? t('chat.unmute') : t('chat.mute')}
          aria-label={summary?.muted ? t('chat.unmute') : t('chat.mute')}
          onClick={() => threadMute.mutate(!summary?.muted)}
        >
          <Icon name={summary?.muted ? 'bellOff' : 'bell'} size={16} />
        </button>
        <button
          type="button"
          className={`icon-btn${threadPin ? ' on' : ''}`}
          aria-pressed={!!threadPin}
          title={threadPin ? t('chat.unpin') : t('chat.pin')}
          aria-label={threadPin ? t('chat.unpin') : t('chat.pin')}
          onClick={() =>
            togglePin.mutate({ pinId: threadPin?.id, targetType: 'thread', targetId: rootId })
          }
        >
          <Icon name="pin" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('chat.thread.close')}
          aria-label={t('chat.thread.close')}
          onClick={onClose}
        >
          <Icon name="x" size={17} />
        </button>
      </div>
      <ChatScope roomId={room.id} parentId={rootId} myRoomRole={room.myRole} messages={messages}>
        {query.isError ? (
          <div className="loading">{t('chat.thread.notFound')}</div>
        ) : (
          <Timeline
            label={t('chat.thread.title')}
            roomId={room.id}
            me={session?.id}
            inThread
            messages={messages}
            lastReadAtOpen={query.isSuccess ? openRead : null}
            targetId={targetId}
            onRetry={(cid) => void sender.retry(cid)}
            onDiscard={sender.discard}
            footer={
              hasMore ? (
                <button
                  type="button"
                  className="btn sm load-more"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('chat.thread.loadMore')}
                </button>
              ) : null
            }
          />
        )}
        <TypingLine roomId={room.id} parentId={rootId} />
        <Composer
          roomId={room.id}
          parentId={rootId}
          agents={agents}
          members={members}
          others={room.kind === 'channel' ? others : []}
          allowHere={room.kind === 'channel'}
          placeholder={t('chat.thread.placeholder')}
          notice={notice}
          onDismissNotice={() => useChatStore.getState().setNotice(scopeKey(room.id, rootId), [])}
          onTyping={ping}
          onSend={(markdown, extra) =>
            void sender.send({ roomId: room.id, parentId: rootId, markdown, ...extra })
          }
        />
      </ChatScope>
    </aside>
  );
}

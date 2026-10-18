import type { MessageQuote } from '@repo/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import type { LocalMessage } from '../../stores/chat';
import { usePeople } from '../workspace/workspace.api';
import {
  useDeleteMessage,
  useMarkUnread,
  usePins,
  useTogglePin,
  useToggleReaction,
} from './chat.api';
import { useChatScope } from './chat-scope';
import { canDeleteMessage, canEditMessage, EMOJI_SET } from './chat.logic';

function excerpt(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function messageLink(roomId: string, messageId: string, parentId: string | null): string {
  const params = new URLSearchParams();
  if (parentId) params.set('thread', parentId);
  params.set('message', messageId);
  const hash = `/chat/${roomId}?${params.toString()}`;
  return `${location.origin}${location.pathname}${location.search}#${hash}`;
}

/** Hover bar: reaction, reply, quote, and the rest of the message menu. */
export function MessageActions({
  message: m,
  canThread,
  onOpenThread,
}: {
  message: LocalMessage;
  canThread: boolean;
  onOpenThread?: (rootId: string) => void;
}) {
  const t = useT();
  const scope = useChatScope();
  const people = usePeople();
  const pins = usePins();
  const togglePin = useTogglePin();
  const toggleReaction = useToggleReaction(scope?.roomId ?? '');
  const remove = useDeleteMessage(scope?.roomId ?? '');
  const unread = useMarkUnread(scope?.roomId ?? '');
  const [emoji, setEmoji] = useState(false);
  const [more, setMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!emoji && !more) return;
    const onDown = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) {
        setEmoji(false);
        setMore(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setEmoji(false);
        setMore(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emoji, more]);

  if (!scope || m.local || m.deleted) return null;

  const pin = pins.find((p) => p.targetType === 'message' && p.targetId === m.id);
  const mine = canEditMessage(scope.me, m.author);
  const canDelete = canDeleteMessage({
    me: scope.me,
    author: m.author,
    myRoomRole: scope.myRoomRole,
    workspaceRole: scope.workspaceRole,
  });
  const authorName =
    m.author.kind === 'external' ? m.author.name : people.name(m.author.id) || t('chat.unknown');

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
    setMore(false);
  };

  const quote = (): MessageQuote => ({
    id: m.id,
    authorName,
    excerpt: excerpt(m.markdown),
  });

  return (
    <div className="msg-actions" role="toolbar" aria-label={t('chat.messageActions')} ref={bar}>
      <div className="msg-pop-anchor">
        <button
          type="button"
          className="icon-btn"
          title={t('chat.actions.addReaction')}
          aria-label={t('chat.actions.addReaction')}
          aria-expanded={emoji}
          onClick={() => {
            setMore(false);
            setEmoji((v) => !v);
          }}
        >
          <span className="emoji-face" aria-hidden="true">
            🙂
          </span>
        </button>
        {emoji && (
          <div className="emoji-pop" role="menu">
            {EMOJI_SET.map((key) => (
              <button
                key={key}
                type="button"
                className="emoji-opt"
                onClick={() => {
                  toggleReaction.mutate({ message: m, key });
                  setEmoji(false);
                }}
              >
                {key}
              </button>
            ))}
          </div>
        )}
      </div>
      {canThread && onOpenThread && (
        <button
          type="button"
          className="icon-btn"
          title={t('chat.thread.replyInThread')}
          aria-label={t('chat.thread.replyInThread')}
          onClick={() => onOpenThread(m.id)}
        >
          <Icon name="thread" size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        title={t('chat.actions.quote')}
        aria-label={t('chat.actions.quote')}
        onClick={() => scope.setQuote(quote())}
      >
        <Icon name="pen" size={14} />
      </button>
      <div className="msg-pop-anchor">
        <button
          type="button"
          className="icon-btn"
          title={t('chat.actions.more')}
          aria-label={t('chat.actions.more')}
          aria-expanded={more}
          onClick={() => {
            setEmoji(false);
            setMore((v) => !v);
          }}
        >
          <Icon name="more" size={15} />
        </button>
        {more && (
          <div className="pop-menu msg-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="pop-item"
              onClick={() => void copy(m.markdown)}
            >
              <Icon name="copy" size={14} />
              <span>{copied ? t('chat.actions.copied') : t('chat.actions.copy')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="pop-item"
              onClick={() =>
                void copy(messageLink(scope.roomId, m.id, m.parentId ?? scope.parentId))
              }
            >
              <Icon name="copy" size={14} />
              <span>{t('chat.actions.copyLink')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="pop-item"
              disabled={togglePin.isPending}
              onClick={() => {
                togglePin.mutate({ pinId: pin?.id, targetType: 'message', targetId: m.id });
                setMore(false);
              }}
            >
              <Icon name="pin" size={14} />
              <span>{pin ? t('chat.actions.unpin') : t('chat.actions.pin')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="pop-item"
              disabled={m.seq == null || unread.isPending}
              onClick={() => {
                if (m.seq == null) return;
                unread.mutate({
                  rootId: m.parentId ?? scope.parentId,
                  throughSeq: m.seq,
                });
                setMore(false);
              }}
            >
              <Icon name="bell" size={14} />
              <span>{t('chat.actions.markUnread')}</span>
            </button>
            {mine && (
              <button
                type="button"
                role="menuitem"
                className="pop-item"
                onClick={() => {
                  scope.startEdit(m.id);
                  setMore(false);
                }}
              >
                <Icon name="pen" size={14} />
                <span>{t('chat.actions.edit')}</span>
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                className="pop-item danger"
                onClick={() => {
                  setMore(false);
                  setConfirming(true);
                }}
              >
                <Icon name="x" size={14} />
                <span>{t('chat.actions.delete')}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {confirming && (
        <Modal onClose={() => setConfirming(false)} label={t('chat.actions.deleteTitle')}>
          <h3>{t('chat.actions.deleteTitle')}</h3>
          <p>{t('chat.actions.deleteBody')}</p>
          {remove.error instanceof Error && <div className="err-line">{remove.error.message}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('chat.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(m.id, { onSuccess: () => setConfirming(false) })}
            >
              {t('chat.actions.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { formatDate, useT } from '../../i18n';
import { useNow } from '../../lib/use-now';
import type { LocalMessage } from '../../stores/chat';
import { buildTimeline, dayDiff } from './chat.timeline';
import { MessageItem, type MessageItemProps } from './MessageItem';

const NEAR_BOTTOM_PX = 80;
const NEAR_TOP_PX = 160;
const FLASH_MS = 2500;

interface TimelineProps extends Pick<
  MessageItemProps,
  'roomId' | 'dm' | 'me' | 'inThread' | 'onOpenThread' | 'onRetry' | 'onDiscard'
> {
  messages: LocalMessage[];
  /** Older messages can still be loaded (the list grows upward). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Read cursor when the view was opened; null hides the "new messages" divider. */
  lastReadAtOpen: number | null;
  /** Scroll to and flash this message once it is loaded. */
  targetId?: string;
  /** Shown instead of the list while there are no messages. */
  empty?: ReactNode;
  /** After the last message (for example "load more replies"). */
  footer?: ReactNode;
  /** Scroll position starts at the first "new" divider instead of the bottom. */
  jumpToNew?: boolean;
  label: string;
}

export function Timeline({
  messages,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  lastReadAtOpen,
  targetId,
  empty,
  footer,
  jumpToNew = true,
  label,
  roomId,
  dm,
  me,
  inThread,
  onOpenThread,
  onRetry,
  onDiscard,
}: TimelineProps) {
  const t = useT();
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; firstId: string | undefined } | null>(null);
  const initial = useRef(false);
  const targetDone = useRef<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [seenId, setSeenId] = useState<string | undefined>(undefined);
  const [flash, setFlash] = useState<string | null>(null);

  const rows = useMemo(
    () => buildTimeline(messages, { lastReadSeq: lastReadAtOpen, me }),
    [messages, lastReadAtOpen, me],
  );
  const firstId = messages[0]?.id;
  const lastId = messages[messages.length - 1]?.id;

  const loadOlder = () => {
    const el = ref.current;
    if (!el || !hasMore || loadingMore || !onLoadMore) return;
    anchor.current = { height: el.scrollHeight, firstId };
    onLoadMore();
  };

  // Keep the reading position when older messages are prepended; otherwise follow new content
  // while the user is at the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.current;
    if (a && firstId !== a.firstId) {
      el.scrollTop += el.scrollHeight - a.height;
      anchor.current = null;
      return;
    }
    if (!initial.current && messages.length) {
      initial.current = true;
      const divider = jumpToNew ? el.querySelector<HTMLElement>('[data-new-divider]') : null;
      if (divider && !targetId) {
        stick.current = false;
        el.scrollTop = Math.max(0, divider.offsetTop - 48);
        setAtBottom(false);
        return;
      }
    }
    // Sending a message always brings the view down to it.
    if (messages[messages.length - 1]?.local === 'sending') stick.current = true;
    if (stick.current && !targetId) el.scrollTop = el.scrollHeight;
  }, [messages, firstId, jumpToNew, targetId]);

  // A short list that does not fill the view has no scroll event to load more history.
  useEffect(() => {
    const el = ref.current;
    if (el && hasMore && !loadingMore && el.scrollHeight <= el.clientHeight + 4) loadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, messages.length]);

  // Jump to a linked message, loading older pages until it shows up.
  useEffect(() => {
    if (!targetId || targetDone.current === targetId) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(targetId)}"]`);
    if (el) {
      targetDone.current = targetId;
      stick.current = false;
      el.scrollIntoView({ block: 'center' });
      setFlash(targetId);
      const timer = setTimeout(() => setFlash(null), FLASH_MS);
      return () => clearTimeout(timer);
    }
    if (hasMore && !loadingMore) onLoadMore?.();
  }, [targetId, messages, hasMore, loadingMore, onLoadMore]);

  // At the bottom everything counts as seen (adjusting state while rendering, not in an effect).
  if (atBottom && seenId !== lastId) setSeenId(lastId);

  const unseen = useMemo(() => {
    const i = messages.findIndex((m) => m.id === seenId);
    if (i < 0) return 0;
    return messages.slice(i + 1).filter((m) => !(m.author.kind === 'human' && m.author.id === me))
      .length;
  }, [messages, seenId, me]);

  const dayLabel = (at: string) => {
    const diff = dayDiff(at, now);
    if (diff === 0) return t('chat.today');
    if (diff === 1) return t('chat.yesterday');
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
    return formatDate(at, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? null : { year: 'numeric' }),
    });
  };

  const toBottom = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="timeline-wrap">
      <div
        className="timeline"
        ref={ref}
        role="log"
        aria-label={label}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          stick.current = near;
          setAtBottom(near);
          if (el.scrollTop < NEAR_TOP_PX) loadOlder();
        }}
      >
        {loadingMore && <div className="tl-loading">{t('chat.loadingOlder')}</div>}
        {rows.map((row) => {
          if (row.type === 'day')
            return (
              <div key={`d-${row.key}`} className="day-div" role="separator">
                <span>{dayLabel(row.at)}</span>
              </div>
            );
          if (row.type === 'new')
            return (
              <div key="new" className="new-div" role="separator" data-new-divider>
                <span>{t('chat.newMessages', { n: row.count })}</span>
              </div>
            );
          const m = row.message;
          return (
            <MessageItem
              key={m.clientMessageId && m.author.kind === 'human' ? `c-${m.clientMessageId}` : m.id}
              message={m}
              roomId={roomId}
              dm={dm}
              me={me}
              grouped={row.grouped}
              inThread={inThread}
              highlighted={flash === m.id}
              onOpenThread={onOpenThread}
              onRetry={onRetry}
              onDiscard={onDiscard}
            />
          );
        })}
        {!messages.length && empty}
        {footer}
      </div>
      {!atBottom && (
        <button type="button" className="to-bottom" onClick={toBottom}>
          <Icon name="arrowDown" size={15} />
          {unseen > 0 ? t('chat.newBelow', { n: unseen }) : t('chat.backToBottom')}
        </button>
      )}
    </div>
  );
}

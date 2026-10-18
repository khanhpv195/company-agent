import type { Room } from '@repo/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { useT } from '../../i18n';
import { useNow } from '../../lib/use-now';
import { useChatStore } from '../../stores/chat';
import { useMarkAllRead, usePins, useRooms } from './chat.api';
import { buildSidebar, hasUnread, isJoinedChannel } from './chat.sidebar';
import { MentionsFeed } from './MentionsFeed';
import { NewMenu } from './NewMenu';
import { Badges, ChannelRow, DmRow, PinRow, ThreadRow } from './SidebarRows';
import { StartDmList } from './StartDmList';

function Section({
  id,
  icon,
  title,
  count,
  extra,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  /** Unread and mentions inside, shown while the section is collapsed. */
  count?: { unread: number; mentions: number };
  extra?: ReactNode;
  children: ReactNode;
}) {
  const closed = useChatStore((s) => s.collapsed.includes(id));
  const toggle = useChatStore((s) => s.toggleCollapsed);
  return (
    <>
      <div
        className={`sec ${closed ? 'closed' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={!closed}
        onClick={() => toggle(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(id);
          }
        }}
      >
        <Icon name="chev" className="chev" />
        <Icon name={icon} size={16} />
        <span>{title}</span>
        {closed && count && <Badges unread={count.unread} mentions={count.mentions} />}
        {extra}
      </div>
      {!closed && children}
    </>
  );
}

const sumCounts = (rooms: Room[]) => ({
  unread: rooms.reduce((n, r) => n + (r.muted ? 0 : (r.unread ?? 0)), 0),
  mentions: rooms.reduce((n, r) => n + (r.mentions ?? 0), 0),
});

export function ChatPanel({
  activeId,
  activeThread,
}: {
  activeId: string | undefined;
  activeThread?: string;
}) {
  const t = useT();
  const rooms = useRooms();
  const pins = usePins();
  const now = useNow();
  const markAll = useMarkAllRead();
  const lastOpened = useChatStore((s) => s.lastOpened);
  const touchRoom = useChatStore((s) => s.touchRoom);
  const collapsed = useChatStore((s) => s.collapsed);
  const toggleCollapsed = useChatStore((s) => s.toggleCollapsed);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  // A channel seen for the first time starts "recently used" rather than "less used".
  useEffect(() => {
    for (const r of rooms)
      if (isJoinedChannel(r) && lastOpened[r.id] === undefined) touchRoom(r.id);
  }, [rooms, lastOpened, touchRoom]);

  // `now` ticks every second; the 7-day rule only needs minute resolution.
  const minute = Math.floor(now / 60_000);
  const model = useMemo(
    () => buildSidebar({ rooms, pins, lastOpened, now: minute * 60_000, unreadOnly, activeId }),
    [rooms, pins, lastOpened, minute, unreadOnly, activeId],
  );
  const anyUnread = rooms.some(hasUnread) || rooms.some((r) => r.threads.some(hasUnread));
  const startNew = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (collapsed.includes('dm')) toggleCollapsed('dm');
    setFocusTick((n) => n + 1);
  };
  const empty = (text: string) => <div className="empty-line">{text}</div>;
  const nothing =
    !model.pinned.length && !model.home.length && !model.lessUsed.length && !model.dms.length;

  return (
    <aside className="panel" aria-label={t('chat.title')}>
      <div className="panel-head drag" data-tauri-drag-region>
        <h3>{t('chat.title')}</h3>
        <NewMenu />
      </div>
      <div className="sb-chips">
        <button
          type="button"
          className={`sb-chip${unreadOnly ? ' on' : ''}`}
          aria-pressed={unreadOnly}
          disabled={mentionsOnly}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          {t('chat.tabs.unread')}
        </button>
        <button
          type="button"
          className={`sb-chip${mentionsOnly ? ' on' : ''}`}
          aria-pressed={mentionsOnly}
          onClick={() => setMentionsOnly((v) => !v)}
        >
          {t('chat.tabs.mentions')}
        </button>
        <span className="sp" />
        <button
          type="button"
          className="sb-chip plain"
          disabled={!anyUnread || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <Icon name="checkAll" size={14} />
          {t('chat.markAllRead')}
        </button>
      </div>
      <div className="panel-body">
        {mentionsOnly ? (
          <MentionsFeed />
        ) : (
          <>
            {model.pinned.length > 0 && !unreadOnly && (
              <Section id="pinned" icon="pin" title={t('chat.sections.pinned')}>
                {model.pinned.map((p) => (
                  <PinRow
                    key={p.id}
                    pin={p}
                    active={
                      p.targetType === 'room'
                        ? activeId === p.roomId && !activeThread
                        : activeThread === (p.threadRootId ?? p.targetId)
                    }
                  />
                ))}
              </Section>
            )}
            <Section
              id="home"
              icon="hash"
              title={t('chat.sections.home')}
              count={sumCounts(model.home)}
            >
              {model.home.length
                ? model.home.map((r) => (
                    <ChannelRow key={r.id} room={r} active={activeId === r.id && !activeThread} />
                  ))
                : empty(unreadOnly ? t('chat.allRead') : t('chat.noRooms'))}
            </Section>
            {model.recent.length > 0 && (
              <Section id="recent" icon="clock" title={t('chat.sections.recent')}>
                {model.recent.map((e) =>
                  e.kind === 'room' ? (
                    e.room.kind === 'dm' ? (
                      <DmRow
                        key={`r-${e.room.id}`}
                        room={e.room}
                        now={now}
                        active={activeId === e.room.id && !activeThread}
                      />
                    ) : (
                      <ChannelRow
                        key={`r-${e.room.id}`}
                        room={e.room}
                        active={activeId === e.room.id && !activeThread}
                      />
                    )
                  ) : (
                    <ThreadRow
                      key={`t-${e.thread.id}`}
                      room={e.room}
                      thread={e.thread}
                      active={activeThread === e.thread.id}
                    />
                  ),
                )}
              </Section>
            )}
            {model.lessUsed.length > 0 && (
              <Section
                id="less"
                icon="hourglass"
                title={t('chat.sections.lessUsed')}
                count={sumCounts(model.lessUsed)}
              >
                {model.lessUsed.map((r) => (
                  <ChannelRow key={r.id} room={r} active={activeId === r.id && !activeThread} />
                ))}
              </Section>
            )}
            <Section
              id="dm"
              icon="user"
              title={t('chat.dms')}
              count={sumCounts(model.dms)}
              extra={
                <button
                  type="button"
                  className="sec-add"
                  aria-label={t('chat.newMessage')}
                  title={t('chat.newMessage')}
                  onClick={startNew}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Icon name="plus" size={14} />
                </button>
              }
            >
              {model.dms.map((r) => (
                <DmRow key={r.id} room={r} now={now} active={activeId === r.id && !activeThread} />
              ))}
              {!unreadOnly && <StartDmList focusTick={focusTick} />}
            </Section>
            {unreadOnly && nothing && empty(t('chat.allRead'))}
          </>
        )}
      </div>
    </aside>
  );
}

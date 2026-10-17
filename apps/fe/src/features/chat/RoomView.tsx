import type { Message } from '@repo/shared';
import { DemoBadge } from '../../components/DemoBadge';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { AgentAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { usePeople, useSession } from '../workspace/workspace.api';
import { useChat, useMarkRead, useMessages, useRooms, useSendMessage } from './chat.api';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';
import { StartDmList } from './StartDmList';

/** How long a new message must sit before the open chat is marked read again. */
const READ_DEBOUNCE_MS = 500;

const route = getRouteApi('/_app/chat/$chatId');

/** Consecutive messages from the same person (never external channel senders). */
function sameAuthor(prev: Message | undefined, m: Message) {
  if (!prev) return false;
  const a = prev.author;
  const b = m.author;
  if (a.kind === 'external' || b.kind === 'external') return false;
  return a.kind === b.kind && a.id === b.id;
}

export function RoomView() {
  const t = useT();
  const { chatId } = route.useParams();
  const chat = useChat(chatId);
  const messages = useMessages(chatId);
  const send = useSendMessage(chatId);
  const markRead = useMarkRead();
  const people = usePeople();
  const me = useSession().data?.user.id;
  const timeline = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { mutate: read } = markRead;

  useEffect(() => read(chatId), [chatId, read]);

  // New messages while this chat is open count as seen: re-mark it read (debounced), but only
  // while the window is visible so a hidden window keeps its unread badge.
  const lastId = messages.data?.[messages.data.length - 1]?.id;
  useEffect(() => {
    if (!lastId) return;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') read(chatId);
    }, READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [chatId, lastId, read]);

  // Follow new content while the user is at the bottom.
  const list = messages.data;
  useLayoutEffect(() => {
    const el = timeline.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list]);
  useLayoutEffect(() => {
    stick.current = true;
  }, [chatId]);

  if (chat.isError)
    return (
      <main className="main">
        <div className="loading">{t('chat.notFound')}</div>
      </main>
    );

  const info = chat.data;
  const agents = (info?.agentIds ?? []).map((id) => people.agent(id)).filter((a) => !!a);
  const isDm = info?.kind === 'dm';
  const dmAgent = isDm ? agents[0] : undefined;
  const offline =
    dmAgent && dmAgent.status === 'offline' ? t('chat.agentOffline', { name: dmAgent.name }) : null;

  return (
    <main className={isDm ? 'main room-dm' : 'main'}>
      <div className="chat-head drag" data-tauri-drag-region>
        {dmAgent && <AgentAvatar agent={dmAgent} size={26} />}
        <div>
          <div className="title">
            {info?.title ?? '…'} {dmAgent && <span className="spark">✳</span>}
            {dmAgent?.simulated && <DemoBadge />}
          </div>
          {info?.subtitle && <div className="sub">{info.subtitle}</div>}
        </div>
        <div className="right">
          <button className="icon-btn" title={t('chat.callSoon')} disabled>
            <Icon name="phone" size={17} />
          </button>
          <button className="icon-btn" title={t('chat.more')}>
            <Icon name="more" />
          </button>
        </div>
      </div>
      <div
        className="timeline"
        ref={timeline}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {list?.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            dm={isDm}
            me={me}
            grouped={isDm && sameAuthor(list[i - 1], m)}
          />
        ))}
        {list && !list.length && (
          <div className="empty-line" style={{ padding: '40px 70px' }}>
            {t('chat.emptyPrefix')}
            <code>@</code>
            {t('chat.emptySuffix')}
          </div>
        )}
      </div>
      <Composer
        key={chatId}
        agents={agents}
        members={people.members.filter((m) => m.id !== me)}
        disabledReason={offline}
        onSend={(text) => {
          stick.current = true;
          send.mutate(text);
        }}
      />
    </main>
  );
}

export function ChatEmpty() {
  const t = useT();
  const rooms = useRooms();
  if (!rooms.length)
    return (
      <main className="main">
        <div
          className="empty-state"
          style={{ alignContent: 'center', width: 360, margin: '0 auto' }}
        >
          <p style={{ color: 'var(--muted)', margin: '0 0 12px', textAlign: 'center' }}>
            {t('chat.emptyHint')}
          </p>
          <div style={{ width: '100%' }}>
            <StartDmList />
          </div>
        </div>
      </main>
    );
  return (
    <main className="main">
      <div className="empty-state">
        <svg width="220" height="200" viewBox="0 0 220 200" aria-hidden="true">
          <defs>
            <radialGradient id="v" cx=".5" cy=".5" r=".5">
              <stop offset=".7" stopColor="#000" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <mask id="m">
              <rect width="220" height="200" fill="url(#v)" />
            </mask>
          </defs>
          <g mask="url(#m)">
            <rect width="220" height="200" fill="#e7ecf1" />
            <path d="M0 95 L50 70 L90 88 L140 62 L220 90 V110 H0Z" fill="#b8c2d3" />
            <rect y="105" width="220" height="40" fill="#cdd9e3" />
            <rect y="104" width="220" height="3" fill="#f5efd9" opacity=".8" />
            <rect y="140" width="220" height="60" fill="#efe7d8" />
            <rect y="128" width="70" height="20" fill="#f4efe6" />
            <g stroke="#8a5a34" strokeWidth="4" strokeLinecap="round" fill="none">
              <path d="M120 95 V160 M150 95 V170 M120 130 H150 M118 132 L112 172 M152 130 L156 176" />
              <path d="M120 102 H150 M120 112 H150" strokeWidth="3" />
            </g>
          </g>
        </svg>
      </div>
    </main>
  );
}

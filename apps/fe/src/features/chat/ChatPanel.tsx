import type { Room, Thread } from '@repo/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { AgentAvatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { short } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useUi } from '../../stores/ui';
import { usePeople } from '../workspace/workspace.api';
import { useRooms } from './chat.api';

const TABS = ['Home', 'Recent', 'Unread', '@me'] as const;
type Tab = (typeof TABS)[number];

function Section({
  id,
  icon,
  title,
  extra,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const closed = useUi((s) => s.closedSections.includes(id));
  const toggle = useUi((s) => s.toggleSection);
  return (
    <>
      <div
        className={`sec ${closed ? 'closed' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={!closed}
        onClick={() => toggle(id)}
        onKeyDown={(e) => e.key === 'Enter' && toggle(id)}
      >
        <Icon name="chev" className="chev" />
        <Icon name={icon} size={16} />
        <span>{title}</span>
        {extra}
      </div>
      {!closed && children}
    </>
  );
}

export function ChatPanel({ activeId }: { activeId: string | undefined }) {
  const rooms = useRooms();
  const people = usePeople();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('Home');

  const dmItem = (r: Room) => {
    const agent = people.agent(r.agentId);
    return (
      <Link
        key={r.id}
        to="/chat/$chatId"
        params={{ chatId: r.id }}
        className={`item ${activeId === r.id ? 'on' : ''}`}
      >
        {agent ? <AgentAvatar agent={agent} /> : <span className="av human">{r.name[0]}</span>}
        <div className="meta">
          <div className="row">
            <span className="name">{agent?.name ?? r.name}</span>
            <span className="time">{short(r.lastMessageAt, now)}</span>
          </div>
          <div className="prev">{r.preview}</div>
        </div>
      </Link>
    );
  };
  const threadItem = (t: Thread) => (
    <Link
      key={t.id}
      to="/chat/$chatId"
      params={{ chatId: t.id }}
      className={`item ${activeId === t.id ? 'on' : ''}`}
    >
      <div
        className="av human"
        style={t.connectionId ? { background: connectionColor(t.connectionId) } : undefined}
      >
        {t.name[0].toUpperCase()}
      </div>
      <div className="meta">
        <div className="row">
          <span className="name">{t.name}</span>
          <span className="time">
            {t.unread ? <span className="badge">{t.unread}</span> : short(t.lastMessageAt, now)}
          </span>
        </div>
        <div className="prev">{t.preview}</div>
      </div>
    </Link>
  );

  const dms = rooms.filter((r) => r.kind === 'dm');
  const channels = rooms.filter((r) => r.kind === 'channel');
  const recent = [
    ...dms.map((r) => ({ at: r.lastMessageAt, node: dmItem(r) })),
    ...channels.flatMap((c) =>
      c.threads.map((t) => ({ at: t.lastMessageAt, node: threadItem(t) })),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));

  let body: ReactNode;
  if (tab === 'Home')
    body = (
      <>
        <Section id="dm" icon="user" title="Direct messages">
          {dms.map(dmItem)}
        </Section>
        {channels.map((c) => (
          <Section
            key={c.id}
            id={c.id}
            icon={c.icon}
            title={c.name}
            extra={
              c.isPrivate ? (
                <span style={{ color: 'var(--muted)', display: 'flex' }} title="Riêng tư">
                  <Icon name="lock" size={13} />
                </span>
              ) : null
            }
          >
            {c.threads.length ? (
              c.threads.map(threadItem)
            ) : (
              <div className="empty-line">No participating threads yet.</div>
            )}
          </Section>
        ))}
      </>
    );
  else if (tab === 'Recent') body = recent.map((x) => x.node);
  else if (tab === 'Unread') {
    const unread = channels.flatMap((c) => c.threads.filter((t) => t.unread > 0)).map(threadItem);
    body = unread.length ? (
      unread
    ) : (
      <div className="empty-line" style={{ paddingLeft: 20 }}>
        Đã đọc hết.
      </div>
    );
  } else
    body = (
      <div className="empty-line" style={{ paddingLeft: 20 }}>
        Chưa có ai nhắc đến bạn.
      </div>
    );

  return (
    <aside className="panel" aria-label="Chat">
      <div className="panel-head drag" data-tauri-drag-region>
        <h3>Chat</h3>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'on' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="panel-body">{body}</div>
    </aside>
  );
}

const COLORS: Record<string, string> = { zalo: '#0068ff', facebook: '#1877f2', gmail: '#ea4335' };
const connectionColor = (id: string) => COLORS[id] ?? 'var(--avatar)';

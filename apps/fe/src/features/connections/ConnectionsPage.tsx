import type { Connection } from '@repo/shared';
import { Link } from '@tanstack/react-router';
import { AgentArt } from '../../components/Avatar';
import { ChannelLogo, LetterLogo } from '../../components/ChannelLogo';
import { DemoBadge } from '../../components/DemoBadge';
import { Icon } from '../../components/Icon';
import { useT, type MessageKey } from '../../i18n';
import { useUi } from '../../stores/ui';
import { MANAGER_ONLY_HINT } from '../people/agent-form.logic';
import { useCanManage } from '../people/people.api';
import { useRooms } from '../chat/chat.api';
import { inboxThreadId } from '../chat/chat.logic';
import { usePeople, useSession } from '../workspace/workspace.api';
import { useConnectionActions, useConnections } from './connections.api';
import { connectionCta, isSimulated, isUnavailable } from './connections.logic';

const SOON: [string, MessageKey, string, string, string][] = [
  ['Telegram', 'connections.soonItems.telegram', '#29a9eb', '#fff', 'T'],
  ['Slack', 'connections.soonItems.slack', '#4a154b', '#fff', 'S'],
  ['Google Calendar', 'connections.soonItems.calendar', '#1a73e8', '#fff', '31'],
  ['Notion', 'connections.soonItems.notion', '#191919', '#fff', 'N'],
  ['Instagram', 'connections.soonItems.instagram', '#d62976', '#fff', 'Ig'],
  ['Webhook', 'connections.soonItems.webhook', '#efede6', '#5c5c58', '{}'],
];

export function ConnectionsPage() {
  const t = useT();
  const connections = useConnections();
  const session = useSession().data;
  return (
    <main className="main">
      <div className="dash">
        <div className="dash-in">
          <div className="page-head drag" data-tauri-drag-region>
            <div>
              <div className="dash-date">
                {t('connections.workspaceSlug', { slug: session?.workspace.slug ?? '' })}
              </div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  letterSpacing: '-0.035em',
                  margin: '0 0 8px',
                }}
              >
                {t('connections.title')}
              </h1>
              <p
                style={{
                  color: 'var(--soft)',
                  margin: '0 0 22px',
                  maxWidth: 640,
                  lineHeight: 1.55,
                }}
              >
                {t('connections.lead')}
              </p>
            </div>
          </div>
          <div className="flow">
            <div className="step">
              <span style={{ display: 'flex', gap: 4 }}>
                {['zalo', 'facebook', 'gmail'].map((k) => (
                  <ChannelLogo key={k} id={k} size={20} />
                ))}
              </span>
              {t('connections.flow.customer')}
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="inbox" size={16} />
              {t('connections.flow.toRoom')} <code>#…-inbox</code>
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <span className="av" style={{ width: 20, height: 20 }}>
                <AgentArt variant={0} />
              </span>
              {t('connections.flow.agentDraft')}
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="check" size={16} />
              {t('connections.flow.approve')}{' '}
              <span style={{ color: 'var(--muted)' }}>{t('connections.flow.optional')}</span>
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="send" size={15} />
              {t('connections.flow.sendBack')}
            </div>
          </div>
          <div className="h-sec">{t('connections.channels')}</div>
          <div className="conn-grid">
            {connections.map((c) => (
              <ConnectionCard key={c.id} c={c} />
            ))}
          </div>
          <div className="h-sec">{t('connections.soon')}</div>
          <div className="conn-grid soon">
            {SOON.map(([name, descKey, bg, fg, letter]) => (
              <div key={name} className="conn">
                <div className="top">
                  <LetterLogo bg={bg} fg={fg} text={letter} size={44} />
                  <div>
                    <h4>{name}</h4>
                    <div className="s">{t(descKey)}</div>
                  </div>
                  <span className="pill">{t('connections.soon')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const t = useT();
  const setWizard = useUi((s) => s.setWizard);
  const { disconnect } = useConnectionActions();
  const canManage = useCanManage();
  const people = usePeople();
  const rooms = useRooms();
  const inboxId = inboxThreadId(rooms, c.id) ?? c.roomId;
  const cta = connectionCta(c);
  const unavailable = isUnavailable(c);
  const demo = isSimulated(c) && <DemoBadge />;
  const gate = { disabled: !canManage, title: canManage ? undefined : t(MANAGER_ONLY_HINT) };
  const unavailableGate = {
    disabled: !canManage || unavailable,
    title: canManage ? (unavailable ? t('connections.unavailableHint') : undefined) : gate.title,
  };
  if (cta !== 'manage')
    return (
      <div className="conn">
        <div className="top">
          <ChannelLogo id={c.id} size={44} />
          <div>
            <h4>
              {c.name} {demo}
            </h4>
            <div className="s">{c.accountLabel}</div>
          </div>
          <span className="pill">
            {cta === 'soon' ? t('connections.comingSoon') : t('connections.notConnected')}
          </span>
        </div>
        <p>{c.description}</p>
        <div className="chips">
          {c.capabilities.map((x) => (
            <span key={x} className="chip">
              {x}
            </span>
          ))}
        </div>
        <div className="foot">
          <button className="btn primary" {...unavailableGate} onClick={() => setWizard(c.id)}>
            <Icon name="plug" size={15} /> {t('connections.connectShort', { name: c.shortName })}
          </button>
        </div>
      </div>
    );
  return (
    <div className="conn on">
      <div className="top">
        <ChannelLogo id={c.id} size={44} />
        <div>
          <h4>
            {c.name} {demo}
          </h4>
          <div className="s">{c.account}</div>
        </div>
        <span className="pill ok">
          <span className="dot on" style={{ boxShadow: 'none' }} />
          {t('connections.active')}
        </span>
      </div>
      <dl className="kv">
        <dt>{t('connections.inboxRoom')}</dt>
        <dd>
          {inboxId ? (
            <Link className="link" to="/chat/$chatId" params={{ chatId: inboxId }}>
              #{c.roomName}
            </Link>
          ) : (
            <>#{c.roomName}</>
          )}
        </dd>
        <dt>{t('connections.agent')}</dt>
        <dd>{people.name(c.agentId)}</dd>
        <dt>{t('connections.replyMode')}</dt>
        <dd>{c.mode === 'draft' ? t('connections.mode.draft') : t('connections.mode.auto')}</dd>
      </dl>
      <div className="foot">
        {inboxId && (
          <Link className="btn" to="/chat/$chatId" params={{ chatId: inboxId }}>
            <Icon name="inbox" size={15} /> {t('connections.openRoom')}
          </Link>
        )}
        <button className="btn" {...unavailableGate} onClick={() => setWizard(c.id)}>
          {t('connections.configure')}
        </button>
        <button
          className="btn"
          style={{ color: 'var(--err)' }}
          {...gate}
          onClick={() => disconnect.mutate(c.id)}
        >
          {t('connections.disconnect')}
        </button>
      </div>
    </div>
  );
}

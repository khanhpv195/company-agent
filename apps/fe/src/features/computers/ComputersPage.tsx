import { DemoBadge } from '../../components/DemoBadge';
import { useLimitGuard } from '../billing/billing.api';
import { LimitHint } from '../billing/LimitHint';
import type { Computer } from '@repo/shared';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Dot } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ago } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useT, type MessageKey } from '../../i18n';
import { useUi } from '../../stores/ui';
import { useCanManage } from '../people/people.api';
import { usePeople } from '../workspace/workspace.api';
import { RevokeComputerModal } from './RevokeComputerModal';
import { isSimulated } from './computers.logic';

const route = getRouteApi('/_app/computers');
const presence = (c: Computer) => (c.status === 'online' ? 'on' : 'off');
const STATUS_KEY: Record<Computer['status'], MessageKey> = {
  online: 'computers.status.online',
  offline: 'computers.status.offline',
  sleeping: 'computers.status.sleeping',
};

export function ComputersPage() {
  const t = useT();
  const { focus } = route.useSearch();
  const people = usePeople();
  const now = useNow();
  const setOpen = useUi((s) => s.setConnectComputerOpen);
  const openNewAgent = useUi((s) => s.openNewAgent);
  const computerLimit = useLimitGuard('computers');
  const canManage = useCanManage();
  const selected = focus ?? people.computers[0]?.id;
  const [revoking, setRevoking] = useState<Computer | null>(null);
  return (
    <>
      <aside className="panel" aria-label={t('computers.title')}>
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>{t('computers.title')}</h3>
          <button className="icon-btn" title={t('computers.connect')} onClick={() => setOpen(true)}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="panel-body">
          {people.computers.map((c) => (
            <Link
              key={c.id}
              to="/computers"
              search={{ focus: c.id }}
              className={`item ${selected === c.id ? 'on' : ''}`}
            >
              <div
                className="av"
                style={{ background: 'var(--av-neutral-bg)', color: 'var(--av-neutral-fg)' }}
              >
                <Icon name="monitor" size={20} />
              </div>
              <div className="meta">
                <div className="row">
                  <span className="name">{c.name}</span>
                  {isSimulated(c) && <DemoBadge />}
                  {c.revokedAt && <span className="badge">{t('computers.removed')}</span>}
                  <Dot state={presence(c)} style={{ marginTop: 6 }} />
                </div>
                <div className="prev">{c.os}</div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <div className="page-head">
            <div>
              <h2>{t('computers.title')}</h2>
              <p className="lead">{t('computers.lead')}</p>
            </div>
            <div className="limit-row">
              <LimitHint guard={computerLimit} />
              <button
                className="btn primary"
                disabled={computerLimit.blocked}
                title={computerLimit.title}
                onClick={() => setOpen(true)}
              >
                <Icon name="plus" size={16} /> {t('computers.connect')}
              </button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('computers.table.name')}</th>
                <th>{t('computers.table.status')}</th>
                <th>{t('computers.table.heartbeat')}</th>
                <th>{t('computers.table.agents')}</th>
                <th>CLI</th>
                <th>{t('computers.table.keepAwake')}</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {people.computers.map((c) => (
                <tr
                  key={c.id}
                  style={c.id === selected ? { background: 'var(--row-sel)' } : undefined}
                >
                  <td>
                    <b>{c.name}</b>
                    {isSimulated(c) && <DemoBadge />}
                    {c.revokedAt && (
                      <span className="pill" style={{ marginLeft: 8 }}>
                        {t('computers.removed')}
                      </span>
                    )}
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{c.os}</div>
                  </td>
                  <td>
                    <Dot state={presence(c)} /> {t(STATUS_KEY[c.status])}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{ago(c.lastHeartbeatAt, now)}</td>
                  <td>
                    {people.agents
                      .filter((a) => a.computerId === c.id)
                      .map((a) => a.name)
                      .join(', ')}
                  </td>
                  <td>
                    <code>{c.cliVersion}</code>
                  </td>
                  <td>{c.keepAwake ? t('computers.keepAwakeOn') : t('computers.keepAwakeOff')}</td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      {!c.revokedAt && (
                        <button
                          className="btn sm"
                          title={t('computers.addAgentOn', { name: c.name })}
                          onClick={() => openNewAgent(c.id)}
                        >
                          <Icon name="plus" size={14} /> {t('people.addAgent')}
                        </button>
                      )}
                      {c.revokedAt && people.agents.some((a) => a.computerId === c.id) && (
                        <button
                          className="btn sm"
                          title={t('computers.moveAgentsTitle', { name: c.name })}
                          onClick={() => setRevoking(c)}
                        >
                          {t('computers.moveAgents')}
                        </button>
                      )}
                      {!c.revokedAt && (
                        <button
                          className="btn sm"
                          style={{ marginLeft: 6 }}
                          title={t('computers.removeTitle', { name: c.name })}
                          onClick={() => setRevoking(c)}
                        >
                          <Icon name="x" size={14} /> {t('computers.remove')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {revoking && <RevokeComputerModal computer={revoking} onClose={() => setRevoking(null)} />}
    </>
  );
}

import { useLimitGuard } from '../billing/billing.api';
import { LimitHint } from '../billing/LimitHint';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { DemoBadge } from '../../components/DemoBadge';
import { AgentAvatar, Dot, MemberAvatar } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { useUi } from '../../stores/ui';
import { usePeople, ROLE_NAME } from '../workspace/workspace.api';
import { useCanManage } from './people.api';

export function PeopleLayout() {
  const t = useT();
  const people = usePeople();
  const params = useParams({ strict: false });
  const canManage = useCanManage();
  const openNewAgent = useUi((s) => s.openNewAgent);
  const agentLimit = useLimitGuard('agents');
  return (
    <>
      <aside className="panel" aria-label={t('people.title')}>
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>{t('people.title')}</h3>
          <Link
            to="/settings/$section"
            params={{ section: 'members' }}
            className="icon-btn"
            title={t('people.inviteMember')}
          >
            <Icon name="plus" />
          </Link>
        </div>
        <div className="panel-body">
          <div className="sec">
            <Icon name="sparkles" size={16} />
            <span>{t('people.agents')}</span>
          </div>
          {people.agents.map((a) => (
            <Link
              key={a.id}
              to="/people/agents/$agentId"
              params={{ agentId: a.id }}
              className={`item ${params.agentId === a.id ? 'on' : ''}`}
            >
              <AgentAvatar agent={a} />
              <div className="meta">
                <div className="row">
                  <span className="name">
                    {a.name}
                    {a.simulated && <DemoBadge />}
                  </span>
                  <Dot state={agentPresence(a.status)} style={{ marginTop: 6 }} />
                </div>
                <div className="prev">
                  {people.computerOf(a)?.name} ·{' '}
                  {t('people.skillCount', { n: a.skills.filter((s) => s.enabled).length })}
                </div>
              </div>
            </Link>
          ))}
          {canManage && (
            <div style={{ padding: '6px 12px 2px' }}>
              <div className="limit-row">
                <button
                  className="btn sm"
                  disabled={agentLimit.blocked}
                  title={agentLimit.title}
                  onClick={() => openNewAgent()}
                >
                  <Icon name="plus" size={14} /> {t('people.addAgent')}
                </button>
                <LimitHint guard={agentLimit} />
              </div>
            </div>
          )}
          <div className="sec" style={{ marginTop: 8 }}>
            <Icon name="users" size={16} />
            <span>{t('people.members')}</span>
          </div>
          {people.members.map((m) => (
            <Link
              key={m.id}
              to="/people/members/$memberId"
              params={{ memberId: m.id }}
              className={`item ${params.memberId === m.id ? 'on' : ''}`}
            >
              <MemberAvatar member={m} />
              <div className="meta">
                <div className="row">
                  <span className="name">{m.name}</span>
                </div>
                <div className="prev">{ROLE_NAME[m.role]}</div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </>
  );
}

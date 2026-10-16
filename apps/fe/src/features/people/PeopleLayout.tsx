import { Link, Outlet, useParams } from '@tanstack/react-router';
import { AgentAvatar, Dot, MemberAvatar } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { Icon } from '../../components/Icon';
import { usePeople, ROLE_NAME } from '../workspace/workspace.api';

export function PeopleLayout() {
  const people = usePeople();
  const params = useParams({ strict: false });
  return (
    <>
      <aside className="panel" aria-label="People & Agents">
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>People & Agents</h3>
          <Link
            to="/settings/$section"
            params={{ section: 'members' }}
            className="icon-btn"
            title="Mời thành viên"
          >
            <Icon name="plus" />
          </Link>
        </div>
        <div className="panel-body">
          <div className="sec">
            <Icon name="sparkles" size={16} />
            <span>Agents</span>
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
                  <span className="name">{a.name}</span>
                  <Dot state={agentPresence(a.status)} style={{ marginTop: 6 }} />
                </div>
                <div className="prev">
                  {people.computerOf(a)?.name} · {a.skills.filter((s) => s.enabled).length} skills
                </div>
              </div>
            </Link>
          ))}
          <div className="sec" style={{ marginTop: 8 }}>
            <Icon name="users" size={16} />
            <span>Members</span>
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

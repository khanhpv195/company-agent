import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { Icon } from '../../components/Icon';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useOpenDm } from '../chat/chat.api';
import { useTasks } from '../tasks/tasks.api';
import { usePeople } from '../workspace/workspace.api';
import { useAgentActivity, useUpdateAgent } from './people.api';

const route = getRouteApi('/_app/people/agents/$agentId');
const TABS = ['Overview', 'Persona', 'Skills', 'Activity'] as const;
const STATUS_COLOR = {
  completed: 'var(--ok)',
  failed: 'var(--err)',
  expired: 'var(--muted)',
  cancelled: 'var(--muted)',
};

export function AgentPage() {
  const { agentId } = route.useParams();
  const { tab = 'Overview' } = route.useSearch();
  const nav = route.useNavigate();
  const navigate = useNavigate();
  const people = usePeople();
  const agent = people.agent(agentId);
  const activity = useAgentActivity(agentId, !!agent);
  const tasks = useTasks().data ?? [];
  const update = useUpdateAgent(agentId);
  const openDm = useOpenDm();
  const now = useNow();

  if (!agent)
    return (
      <div className="loading">{people.agents.length ? 'Không tìm thấy agent.' : 'Đang tải…'}</div>
    );
  const pc = people.computerOf(agent);
  const enabled = agent.skills.filter((s) => s.enabled).length;
  const mine = tasks.filter((t) => t.assigneeId === agent.id);
  const current = mine.find((t) => t.activeRun);
  const runs = mine.flatMap((t) => t.runs);

  const message = () =>
    openDm.mutate(agent.id, {
      onSuccess: ({ chatId }) => void navigate({ to: '/chat/$chatId', params: { chatId } }),
    });

  return (
    <div className="page">
      <div className="page-head">
        <div className="agent-hero">
          <AgentAvatar agent={agent} />
          <div>
            <h2>
              {agent.name} <span className="spark">✳</span>
            </h2>
            <div style={{ color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Dot state={agentPresence(agent.status)} />
              {agent.status} · {agent.provider}
              {current && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    className="link"
                    onClick={() => void navigate({ to: '/tasks', search: { task: current.id } })}
                  >
                    đang làm {current.id}
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={message} disabled={openDm.isPending}>
            <Icon name="chat" size={16} /> Nhắn tin
          </button>
          <button
            className="btn"
            onClick={() => void navigate({ to: '/tasks', search: { view: 'agents' } })}
            title="Xem trên Tasks"
          >
            <Icon name="gantt" size={16} />
          </button>
        </div>
      </div>
      <div className="ptabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'on' : ''}
            onClick={() => void nav({ search: { tab: t === 'Overview' ? undefined : t } })}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && (
        <div className="grid2">
          <div className="box">
            <h4>Runtime</h4>
            <dl className="kv">
              <dt>Provider</dt>
              <dd>{agent.provider}</dd>
              <dt>Computer</dt>
              <dd>
                <Dot state={pc?.status === 'online' ? 'on' : 'off'} /> {pc?.name}
              </dd>
              <dt>Workdir</dt>
              <dd>
                <code>{agent.workdir}</code>
              </dd>
              <dt>Max turns</dt>
              <dd>{agent.maxTurns}</dd>
            </dl>
          </div>
          <div className="box">
            <h4>Tasks</h4>
            <dl className="kv">
              <dt>Runs</dt>
              <dd>
                {runs.filter((r) => r.status === 'completed').length} completed ·{' '}
                {runs.filter((r) => r.status === 'failed').length} failed
              </dd>
              <dt>Hàng đợi</dt>
              <dd>{mine.filter((t) => t.status === 'todo').length} task</dd>
              <dt>Chờ duyệt</dt>
              <dd>{mine.filter((t) => t.status === 'review').length} task</dd>
            </dl>
          </div>
        </div>
      )}
      {tab === 'Persona' && (
        <PersonaEditor
          key={agent.id}
          value={agent.persona}
          saving={update.isPending}
          onSave={(persona) => update.mutate({ persona })}
        />
      )}
      {tab === 'Skills' && (
        <>
          <div className="chips">
            {agent.skills.map((s) => (
              <button
                key={s.id}
                className={`chip ${s.enabled ? 'on' : ''}`}
                aria-pressed={s.enabled}
                onClick={() => update.mutate({ skills: [{ id: s.id, enabled: !s.enabled }] })}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 14 }}>
            {enabled}/{agent.skills.length} skill đang bật. Bấm để bật/tắt.
          </p>
        </>
      )}
      {tab === 'Activity' && (
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Yêu cầu</th>
              <th>Trạng thái</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((r) => (
              <tr key={r.id}>
                <td>{r.where}</td>
                <td>{r.request}</td>
                <td>
                  <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{r.status}</span>
                </td>
                <td style={{ color: 'var(--muted)' }}>{rel(r.at, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PersonaEditor({
  value,
  saving,
  onSave,
}: {
  value: string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <>
      <textarea
        className="persona"
        style={{ width: '100%', minHeight: 180, resize: 'vertical', outline: 'none' }}
        aria-label="Persona"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          className="btn primary"
          disabled={saving || draft === value}
          onClick={() => onSave(draft)}
        >
          Lưu persona
        </button>
        {draft !== value && (
          <button className="btn" onClick={() => setDraft(value)}>
            Huỷ thay đổi
          </button>
        )}
      </div>
    </>
  );
}

import type { Agent, UpdateAgentInput } from '@repo/shared';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useOpenDm } from '../chat/chat.api';
import { selectableComputers } from '../computers/computers.logic';
import { useTasks } from '../tasks/tasks.api';
import { usePeople } from '../workspace/workspace.api';
import {
  MANAGER_ONLY_HINT,
  nextAgentAfterDelete,
  validateAgentForm,
  type AgentFormErrors,
} from './agent-form.logic';
import { useAgentActivity, useCanManage, useDeleteAgent, useUpdateAgent } from './people.api';

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
  const remove = useDeleteAgent();
  const canManage = useCanManage();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
          <button
            className="btn"
            style={{ color: 'var(--err)' }}
            disabled={!canManage}
            title={canManage ? 'Xoá agent' : MANAGER_ONLY_HINT}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="x" size={16} /> Xoá agent
          </button>
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
            <h4 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              Runtime
              {!editing && (
                <button
                  className="btn sm"
                  disabled={!canManage}
                  title={canManage ? 'Sửa tên, computer, workdir, max turns' : MANAGER_ONLY_HINT}
                  onClick={() => setEditing(true)}
                >
                  Sửa
                </button>
              )}
            </h4>
            {editing ? (
              <RuntimeEditor
                key={agent.id}
                agent={agent}
                saving={update.isPending}
                error={update.error?.message}
                onCancel={() => {
                  update.reset();
                  setEditing(false);
                }}
                onSave={(patch) =>
                  update.mutate(patch, {
                    onSuccess: () => setEditing(false),
                  })
                }
              />
            ) : (
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
            )}
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
          readOnly={!canManage}
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
                disabled={!canManage}
                title={canManage ? undefined : MANAGER_ONLY_HINT}
                onClick={() => update.mutate({ skills: [{ id: s.id, enabled: !s.enabled }] })}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 14 }}>
            {enabled}/{agent.skills.length} skill đang bật.{' '}
            {canManage ? 'Bấm để bật/tắt.' : `${MANAGER_ONLY_HINT} được đổi skill.`}
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
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} label="Xoá agent">
          <h3>Xoá {agent.name}?</h3>
          <p>
            Run đang chạy sẽ bị huỷ và các task đang giao cho agent được bỏ giao (về Cần làm). DM
            với agent bị ẩn. Lịch sử đã chạy được giữ lại. Không hoàn tác được.
          </p>
          {remove.error && <div className="err-line">{remove.error.message}</div>}
          <div className="wz-foot">
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Huỷ
            </button>
            <button
              className="btn primary"
              style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(agent.id, {
                  onSuccess: () => {
                    // The page stays mounted when it navigates to the next agent; close the
                    // confirm so it does not reopen for that agent.
                    setConfirmDelete(false);
                    const next = nextAgentAfterDelete(people.agents, agent.id);
                    void (next
                      ? navigate({ to: '/people/agents/$agentId', params: { agentId: next } })
                      : navigate({ to: '/computers', search: {} }));
                  },
                })
              }
            >
              Xoá agent
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RuntimeEditor({
  agent,
  saving,
  error,
  onSave,
  onCancel,
}: {
  agent: Agent;
  saving: boolean;
  error: string | undefined;
  onSave: (patch: UpdateAgentInput) => void;
  onCancel: () => void;
}) {
  const people = usePeople();
  const [name, setName] = useState(agent.name);
  const computers = selectableComputers(people.computers);
  // An agent on a revoked computer starts with no selection so the user must pick a live one.
  const [computerId, setComputerId] = useState(
    computers.some((c) => c.id === agent.computerId) ? agent.computerId : '',
  );
  const [workdir, setWorkdir] = useState(agent.workdir);
  const [maxTurns, setMaxTurns] = useState(String(agent.maxTurns));
  const [errors, setErrors] = useState<AgentFormErrors>({});

  const submit = () => {
    const found = validateAgentForm(
      { name, computerId, persona: '', workdir, maxTurns },
      people.agents.filter((a) => a.id !== agent.id).map((a) => a.name),
      computers.map((c) => c.id),
      { requireWorkdir: true },
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    const patch: UpdateAgentInput = {};
    if (name.trim() !== agent.name) patch.name = name.trim();
    if (computerId !== agent.computerId) patch.computerId = computerId;
    if (workdir.trim() !== agent.workdir) patch.workdir = workdir.trim();
    if (Number(maxTurns) !== agent.maxTurns && maxTurns.trim()) patch.maxTurns = Number(maxTurns);
    if (!Object.keys(patch).length) return onCancel();
    onSave(patch);
  };
  const border = (key: keyof AgentFormErrors) =>
    errors[key] ? { borderColor: 'var(--err)' } : undefined;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label>
        Tên
        <input
          className="field"
          style={border('name')}
          aria-label="Tên agent"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Computer
        <select
          className="field"
          style={border('computerId')}
          aria-label="Computer"
          value={computerId}
          onChange={(e) => setComputerId(e.target.value)}
        >
          {!computers.some((c) => c.id === computerId) && <option value="">Chọn computer…</option>}
          {computers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === 'offline' ? ' (offline)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Workdir
        <input
          className="field"
          style={border('workdir')}
          aria-label="Workdir"
          value={workdir}
          onChange={(e) => setWorkdir(e.target.value)}
        />
      </label>
      <label>
        Max turns
        <input
          className="field"
          style={border('maxTurns')}
          aria-label="Max turns"
          inputMode="numeric"
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
        />
      </label>
      {Object.values(errors).map((message) => (
        <div key={message} className="err-line" style={{ marginTop: 0 }}>
          {message}
        </div>
      ))}
      {error && (
        <div className="err-line" style={{ marginTop: 0 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={saving} onClick={submit}>
          Lưu
        </button>
        <button className="btn" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </div>
  );
}

function PersonaEditor({
  value,
  readOnly,
  saving,
  onSave,
}: {
  value: string;
  readOnly: boolean;
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
        readOnly={readOnly}
        title={readOnly ? MANAGER_ONLY_HINT : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          className="btn primary"
          disabled={readOnly || saving || draft === value}
          title={readOnly ? MANAGER_ONLY_HINT : undefined}
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

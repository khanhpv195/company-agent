import { DemoBadge } from '../../components/DemoBadge';
import type { Agent, UpdateAgentInput } from '@repo/shared';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useT, type MessageKey } from '../../i18n';
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
type Tab = (typeof TABS)[number];
const TAB_KEY: Record<Tab, MessageKey> = {
  Overview: 'people.tabs.overview',
  Persona: 'people.tabs.persona',
  Skills: 'people.tabs.skills',
  Activity: 'people.tabs.activity',
};
const STATUS_COLOR = {
  completed: 'var(--ok)',
  failed: 'var(--err)',
  expired: 'var(--muted)',
  cancelled: 'var(--muted)',
};
const RUN_STATUS_KEY: Record<keyof typeof STATUS_COLOR, MessageKey> = {
  completed: 'tasks.runStatus.completed',
  failed: 'tasks.runStatus.failed',
  expired: 'tasks.runStatus.expired',
  cancelled: 'tasks.runStatus.cancelled',
};
const AGENT_STATUS_KEY: Record<Agent['status'], MessageKey> = {
  idle: 'people.agentStatus.idle',
  working: 'people.agentStatus.working',
  offline: 'people.agentStatus.offline',
};

export function AgentPage() {
  const t = useT();
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
      <div className="loading">
        {people.agents.length ? t('people.agentNotFound') : t('people.loading')}
      </div>
    );
  const pc = people.computerOf(agent);
  const enabled = agent.skills.filter((s) => s.enabled).length;
  const mine = tasks.filter((task) => task.assigneeId === agent.id);
  const current = mine.find((task) => task.activeRun);
  const runs = mine.flatMap((task) => task.runs);

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
              {agent.simulated && <DemoBadge />}
            </h2>
            <div style={{ color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Dot state={agentPresence(agent.status)} />
              {t(AGENT_STATUS_KEY[agent.status])} · {agent.provider}
              {current && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    className="link"
                    onClick={() => void navigate({ to: '/tasks', search: { task: current.id } })}
                  >
                    {t('people.workingOn', { id: current.id })}
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
            title={canManage ? t('people.deleteAgent') : t(MANAGER_ONLY_HINT)}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="x" size={16} /> {t('people.deleteAgent')}
          </button>
          <button className="btn" onClick={message} disabled={openDm.isPending}>
            <Icon name="chat" size={16} /> {t('people.message')}
          </button>
          <button
            className="btn"
            onClick={() => void navigate({ to: '/tasks', search: { view: 'agents' } })}
            title={t('people.viewOnTasks')}
          >
            <Icon name="gantt" size={16} />
          </button>
        </div>
      </div>
      <div className="ptabs" role="tablist">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            role="tab"
            aria-selected={tabId === tab}
            className={tabId === tab ? 'on' : ''}
            onClick={() => void nav({ search: { tab: tabId === 'Overview' ? undefined : tabId } })}
          >
            {t(TAB_KEY[tabId])}
          </button>
        ))}
      </div>
      {tab === 'Overview' && (
        <div className="grid2">
          <div className="box">
            <h4 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {t('people.runtime')}
              {!editing && (
                <button
                  className="btn sm"
                  disabled={!canManage}
                  title={canManage ? t('people.editTip') : t(MANAGER_ONLY_HINT)}
                  onClick={() => setEditing(true)}
                >
                  {t('people.edit')}
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
                <dt>{t('people.provider')}</dt>
                <dd>{agent.provider}</dd>
                <dt>{t('people.computer')}</dt>
                <dd>
                  <Dot state={pc?.status === 'online' ? 'on' : 'off'} /> {pc?.name}
                </dd>
                <dt>{t('people.workdir')}</dt>
                <dd>
                  <code>{agent.workdir}</code>
                </dd>
                <dt>{t('people.maxTurns')}</dt>
                <dd>{agent.maxTurns}</dd>
              </dl>
            )}
          </div>
          <div className="box">
            <h4>{t('tasks.title')}</h4>
            <dl className="kv">
              <dt>{t('tasks.drawer.runs')}</dt>
              <dd>
                {t('people.runsSummary', {
                  completed: runs.filter((r) => r.status === 'completed').length,
                  failed: runs.filter((r) => r.status === 'failed').length,
                })}
              </dd>
              <dt>{t('people.queue')}</dt>
              <dd>
                {t('tasks.count', { n: mine.filter((task) => task.status === 'todo').length })}
              </dd>
              <dt>{t('people.waitingReview')}</dt>
              <dd>
                {t('tasks.count', { n: mine.filter((task) => task.status === 'review').length })}
              </dd>
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
                title={canManage ? undefined : t(MANAGER_ONLY_HINT)}
                onClick={() => update.mutate({ skills: [{ id: s.id, enabled: !s.enabled }] })}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 14 }}>
            {t('people.skillsOn', { on: enabled, total: agent.skills.length })}{' '}
            {canManage ? t('people.toggleSkills') : t('people.skillsChangeHint')}
          </p>
        </>
      )}
      {tab === 'Activity' && (
        <table>
          <thead>
            <tr>
              <th>{t('people.activity.room')}</th>
              <th>{t('people.activity.request')}</th>
              <th>{t('people.activity.status')}</th>
              <th>{t('people.activity.time')}</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((r) => (
              <tr key={r.id}>
                <td>{r.where}</td>
                <td>{r.request}</td>
                <td>
                  <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>
                    {t(RUN_STATUS_KEY[r.status])}
                  </span>
                </td>
                <td style={{ color: 'var(--muted)' }}>{rel(r.at, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} label={t('people.deleteAgent')}>
          <h3>{t('people.deleteTitle', { name: agent.name })}</h3>
          <p>{t('people.deleteBody')}</p>
          {remove.error && <div className="err-line">{remove.error.message}</div>}
          <div className="wz-foot">
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              {t('people.cancel')}
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
              {t('people.deleteAgent')}
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
  const t = useT();
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
      t,
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
        {t('people.name')}
        <input
          className="field"
          style={border('name')}
          aria-label={t('people.agentName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t('people.computer')}
        <select
          className="field"
          style={border('computerId')}
          aria-label={t('people.computer')}
          value={computerId}
          onChange={(e) => setComputerId(e.target.value)}
        >
          {!computers.some((c) => c.id === computerId) && (
            <option value="">{t('people.form.chooseComputerOption')}</option>
          )}
          {computers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === 'offline' ? t('people.offlineSuffix') : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('people.workdir')}
        <input
          className="field"
          style={border('workdir')}
          aria-label={t('people.workdir')}
          value={workdir}
          onChange={(e) => setWorkdir(e.target.value)}
        />
      </label>
      <label>
        {t('people.maxTurns')}
        <input
          className="field"
          style={border('maxTurns')}
          aria-label={t('people.maxTurns')}
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
          {t('people.save')}
        </button>
        <button className="btn" onClick={onCancel}>
          {t('people.cancel')}
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
  const t = useT();
  const [draft, setDraft] = useState(value);
  return (
    <>
      <textarea
        className="persona"
        style={{ width: '100%', minHeight: 180, resize: 'vertical', outline: 'none' }}
        aria-label={t('people.persona')}
        readOnly={readOnly}
        title={readOnly ? t(MANAGER_ONLY_HINT) : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          className="btn primary"
          disabled={readOnly || saving || draft === value}
          title={readOnly ? t(MANAGER_ONLY_HINT) : undefined}
          onClick={() => onSave(draft)}
        >
          {t('people.savePersona')}
        </button>
        {draft !== value && (
          <button className="btn" onClick={() => setDraft(value)}>
            {t('people.discardChanges')}
          </button>
        )}
      </div>
    </>
  );
}

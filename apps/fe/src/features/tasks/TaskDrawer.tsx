import { queueOf, runningOf, type Task, type TaskPriority, type TaskStatus } from '@repo/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Inline, Markdown } from '../../components/Markdown';
import { Who } from '../../components/Who';
import { dur, hhmm, mmss, ms, rel, usd } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useT, type MessageKey } from '../../i18n';
import { useUi } from '../../stores/ui';
import { useRooms } from '../chat/chat.api';
import { chatLabel } from '../chat/chat.logic';
import { usePeople } from '../workspace/workspace.api';
import { useTaskActions } from './tasks.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';
import { COLUMNS, PRIORITY_KEYS } from './tasks.logic';

const RUN_COLOR = {
  completed: 'var(--ok)',
  failed: 'var(--err)',
  cancelled: 'var(--muted)',
  expired: 'var(--muted)',
};

const RUN_STATUS_KEY: Record<keyof typeof RUN_COLOR, MessageKey> = {
  completed: 'tasks.runStatus.completed',
  failed: 'tasks.runStatus.failed',
  cancelled: 'tasks.runStatus.cancelled',
  expired: 'tasks.runStatus.expired',
};

export function TaskDrawer({
  task,
  tasks,
  onClose,
}: {
  task: Task;
  tasks: Task[];
  onClose: () => void;
}) {
  const t = useT();
  const people = usePeople();
  const rooms = useRooms();
  const now = useNow();
  const navigate = useNavigate();
  const actions = useTaskActions();
  const setConnectComputerOpen = useUi((s) => s.setConnectComputerOpen);
  const [comment, setComment] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const agent = people.agent(task.assigneeId);
  const run = task.activeRun;
  const room = task.chatId ? chatLabel(rooms, task.chatId, t) : null;
  const canOpenRoom =
    !!task.chatId &&
    rooms.some(
      (r) =>
        (r.id === task.chatId && r.kind === 'dm') || r.threads.some((th) => th.id === task.chatId),
    );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.step]);

  const openRoom = () => {
    if (task.chatId) void navigate({ to: '/chat/$chatId', params: { chatId: task.chatId } });
  };

  let top = null;
  if (run && agent) {
    const pc = people.computer(run.computerId);
    top = (
      <div className="runbox">
        <div className="runbox-h">
          <span className="mini-spin" />
          <b>{t('tasks.drawer.runTitle', { n: run.n })}</b>
          <span style={{ color: 'var(--muted)' }}>
            {t('tasks.drawer.runOn', {
              name: pc?.name ?? '',
              step: Math.min(run.step + 1, run.steps.length),
              total: run.steps.length,
            })}
          </span>
          <span className="sp" />
          <Elapsed since={run.startedAt} />
          <button className="btn sm" onClick={() => actions.stop.mutate(task.id)}>
            <Icon name="stop" size={12} /> {t('tasks.drawer.stop')}
          </button>
          {canOpenRoom && (
            <button className="btn sm" onClick={openRoom}>
              <Icon name="chat" size={12} /> {t('tasks.drawer.openRoom')}
            </button>
          )}
        </div>
        <div className="runlog" ref={logRef} aria-live="polite">
          {run.steps.slice(0, run.step + 1).map((s, i) => (
            <div key={i} className={i < run.step ? 'ok' : 'cur'}>
              <span className="tm">{hhmm(ms(run.startedAt) + i * 5200)}</span>
              {i < run.step ? '✓' : '›'} <span className="tn">{s.tool}</span>
              {s.input}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (task.status === 'doing' && !agent && task.assigneeId) {
    top = (
      <div className="banner hum">
        <Icon name="user" size={16} />{' '}
        {t('tasks.drawer.selfWork', { name: people.name(task.assigneeId) })}
      </div>
    );
  } else if (task.blockedReason) {
    top = (
      <div className="banner blk">
        <Icon name="lock" size={16} />
        <span>
          {t('tasks.drawer.blockedPrefix')}
          <b>{task.blockedReason}</b>
          {t('tasks.drawer.blockedSuffix')}
        </span>
        <span className="sp" />
        <button className="btn sm" onClick={() => setConnectComputerOpen(true)}>
          {t('tasks.drawer.guide')}
        </button>
      </div>
    );
  } else if (task.error) {
    top = (
      <div className="banner err">
        <Icon name="alert" size={16} />
        <span>{task.error}</span>
        <span className="sp" />
        <button className="btn sm" onClick={() => actions.retry.mutate(task.id)}>
          <Icon name="refresh" size={12} /> {t('tasks.drawer.retry')}
        </button>
      </div>
    );
  } else if (task.status === 'review') {
    top = (
      <div className="revbox">
        <div className="h">
          <Icon name="shield" size={15} />{' '}
          {t('tasks.drawer.reviewReady', { name: people.name(task.assigneeId) })}
        </div>
        <div className="out">
          <Markdown text={task.output ?? t('tasks.drawer.noOutput')} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary sm" onClick={() => actions.approve.mutate(task.id)}>
            <Icon name="check" size={12} /> {t('tasks.approve')}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              actions.revise.mutate({ id: task.id, note: comment });
              setComment('');
            }}
            title={t('tasks.drawer.reviseTip')}
          >
            {t('tasks.drawer.revise')}
          </button>
        </div>
      </div>
    );
  } else if (task.status === 'todo' && agent) {
    const queue = queueOf(tasks, agent.id);
    const busy = runningOf(tasks, agent.id);
    top = (
      <div className="banner blk">
        <Icon name="clock" size={16} />
        <span>
          {t('tasks.drawer.position')}{' '}
          <b>
            {queue.findIndex((x) => x.id === task.id) + 1}/{queue.length}
          </b>{' '}
          {t('tasks.drawer.inQueueOf', { name: agent.name })}
          {busy && (
            <>
              {t('tasks.drawer.agentDoing')}
              <b>{busy.id}</b>
            </>
          )}
          .
        </span>
        <span className="sp" />
        <button className="btn sm" onClick={() => actions.runNow.mutate(task.id)}>
          <Icon name="play" size={12} /> {t('tasks.drawer.runNow')}
        </button>
      </div>
    );
  } else if (!task.assigneeId) {
    top = (
      <div className="banner blk">
        <Icon name="user" size={16} />
        <span>
          {t('tasks.drawer.unassignedPrefix')}
          <b>{t('tasks.drawer.assignee')}</b>
          {t('tasks.drawer.unassignedSuffix')}
        </span>
      </div>
    );
  }

  const acts = [...task.activity].sort((a, b) => ms(a.at) - ms(b.at));
  const submitComment = () => {
    const text = comment.trim();
    if (!text) return;
    actions.comment.mutate({ id: task.id, markdown: text });
    setComment('');
  };

  return (
    <div className="drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label={t('tasks.drawer.taskAria', { id: task.id })}>
        <div className="dr-top">
          <StatusIcon status={task.status} />
          <span>{task.id}</span>
          {room && <span>· {room}</span>}
          <span className="sp" />
          <button
            className="icon-btn"
            title={t('tasks.drawer.copyId')}
            onClick={() => void navigator.clipboard?.writeText(task.id).catch(() => {})}
          >
            <Icon name="copy" size={15} />
          </button>
          <button className="icon-btn" title={t('tasks.drawer.close')} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="dr-body">
          <h2>{task.title}</h2>
          <dl className="props">
            <dt>{t('tasks.drawer.status')}</dt>
            <dd>
              <StatusIcon status={task.status} />
              <select
                aria-label={t('tasks.drawer.status')}
                value={task.status}
                onChange={(e) =>
                  actions.move.mutate({
                    id: task.id,
                    status: e.target.value as TaskStatus,
                    beforeId: null,
                  })
                }
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.nameKey)}
                  </option>
                ))}
              </select>
            </dd>
            <dt>{t('tasks.drawer.assignee')}</dt>
            <dd>
              <Who id={task.assigneeId} />
              <select
                aria-label={t('tasks.drawer.assignee')}
                value={task.assigneeId ?? ''}
                onChange={(e) =>
                  actions.update.mutate({ id: task.id, assigneeId: e.target.value || null })
                }
              >
                <option value="">{t('tasks.drawer.unassigned')}</option>
                {people.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.status === 'offline'
                      ? t('tasks.drawer.offlineSuffix')
                      : a.status === 'working'
                        ? t('tasks.drawer.busySuffix')
                        : ''}
                  </option>
                ))}
                {people.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </dd>
            <dt>{t('tasks.drawer.priority')}</dt>
            <dd>
              <PriorityIcon priority={task.priority} />
              <select
                aria-label={t('tasks.drawer.priority')}
                value={task.priority}
                onChange={(e) =>
                  actions.update.mutate({ id: task.id, priority: e.target.value as TaskPriority })
                }
              >
                {Object.entries(PRIORITY_KEYS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </dd>
            <dt>{t('tasks.drawer.labels')}</dt>
            <dd>
              {task.labels.map((l) => (
                <Label key={l} name={l} />
              ))}
            </dd>
            <dt>{t('tasks.reviewLabel')}</dt>
            <dd>
              <label className="nt-chk" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={task.requiresReview}
                  onChange={(e) =>
                    actions.update.mutate({ id: task.id, requiresReview: e.target.checked })
                  }
                />{' '}
                {t('tasks.drawer.requiresReview')}
              </label>
            </dd>
            <dt>{t('tasks.drawer.created')}</dt>
            <dd style={{ color: 'var(--soft)' }}>{rel(task.createdAt, now)}</dd>
          </dl>

          {top}

          {task.description && (
            <>
              <div className="dsec">{t('tasks.drawer.description')}</div>
              <div className="desc">
                <Markdown text={task.description} />
              </div>
            </>
          )}

          {task.subtasks.length > 0 && (
            <>
              <div className="dsec">
                {t('tasks.drawer.subtasks')}{' '}
                <span className="r">
                  {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
                </span>
              </div>
              <div className="subs">
                {task.subtasks.map((s, i) => (
                  <label key={i} className={s.done ? 'dn' : ''}>
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={(e) =>
                        actions.update.mutate({
                          id: task.id,
                          subtasks: task.subtasks.map((x, k) =>
                            k === i ? { ...x, done: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {(run || task.runs.length > 0) && (
            <>
              <div className="dsec">
                {t('tasks.drawer.runs')}{' '}
                <span className="r">{task.runs.length + (run ? 1 : 0)}</span>
              </div>
              <table className="runs">
                <thead>
                  <tr>
                    <th>{t('tasks.drawer.th.run')}</th>
                    <th>{t('tasks.drawer.th.status')}</th>
                    <th>{t('tasks.drawer.th.duration')}</th>
                    <th>{t('tasks.drawer.th.tools')}</th>
                    <th>{t('tasks.drawer.th.cost')}</th>
                    <th>{t('tasks.drawer.th.at')}</th>
                  </tr>
                </thead>
                <tbody>
                  {run && (
                    <tr>
                      <td>#{run.n}</td>
                      <td>
                        <span style={{ color: 'var(--claude)', fontWeight: 600 }}>
                          {t('tasks.runStatus.running')}
                        </span>
                      </td>
                      <td>{mmss(now - ms(run.startedAt))}</td>
                      <td>{run.step}</td>
                      <td />
                      <td style={{ color: 'var(--muted)' }}>{hhmm(ms(run.startedAt))}</td>
                    </tr>
                  )}
                  {task.runs.map((r) => (
                    <tr key={r.n}>
                      <td>#{r.n}</td>
                      <td>
                        <span style={{ color: RUN_COLOR[r.status], fontWeight: 600 }}>
                          {t(RUN_STATUS_KEY[r.status])}
                        </span>
                        {r.error && (
                          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.error}</div>
                        )}
                      </td>
                      <td>{r.durationSec ? dur(r.durationSec) : '–'}</td>
                      <td>{r.toolCalls}</td>
                      <td style={{ color: 'var(--muted)' }}>
                        {r.costUsd != null ? usd(r.costUsd) : '–'}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{rel(r.at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="dsec">{t('tasks.drawer.activity')}</div>
          <ul className="act">
            {acts.map((l) => (
              <li key={l.id}>
                <Who id={l.by} size={22} />
                <div className="bd">
                  <b>{people.name(l.by)}</b>{' '}
                  {l.kind === 'comment' ? (
                    <div className="cm">
                      <Markdown text={l.text} />
                    </div>
                  ) : (
                    <span style={l.tone === 'error' ? { color: 'var(--err)' } : undefined}>
                      <Inline text={l.text} />
                    </span>
                  )}
                </div>
                <span className="t">{rel(l.at, now)}</span>
              </li>
            ))}
            {!acts.length && (
              <li style={{ color: 'var(--muted)' }}>{t('tasks.drawer.noActivity')}</li>
            )}
          </ul>
          <form
            className="cmt"
            onSubmit={(e) => {
              e.preventDefault();
              submitComment();
            }}
          >
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('tasks.drawer.commentPlaceholder')}
              aria-label={t('tasks.drawer.commentLabel')}
              autoComplete="off"
            />
            <button className="btn primary" aria-label={t('tasks.drawer.send')}>
              <Icon name="send" size={14} />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

import { currentStep } from '@repo/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { agentPresence } from '../../components/presence';
import { ChannelLogo } from '../../components/ChannelLogo';
import { Icon, type IconName } from '../../components/Icon';
import { Inline } from '../../components/Markdown';
import { ago, mmss, ms, rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useUi } from '../../stores/ui';
import { formatDate, formatNumber, useT } from '../../i18n';
import { useOpenDm } from '../chat/chat.api';
import { chatLabel } from '../chat/chat.logic';
import { useRooms } from '../chat/chat.api';
import { useConnections } from '../connections/connections.api';
import { useTasks } from '../tasks/tasks.api';
import { C_DONE, C_FAIL } from '../tasks/tasks.logic';
import { usePeople, useSession } from '../workspace/workspace.api';
import { api } from '../../lib/api-client';
import { AssignmentsChart, AssignmentsTable } from './AssignmentsChart';
import { useDashboard, useResolveAttention } from './dashboard.api';

const ATTN_ICON: Record<string, [IconName, string]> = {
  error: ['x', 'err'],
  warning: ['clock', 'warn'],
  offline: ['monitor', 'off'],
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function DashboardPage() {
  const t = useT();
  const session = useSession().data;
  const summary = useDashboard();
  const tasks = useTasks().data ?? [];
  const rooms = useRooms();
  const connections = useConnections();
  const people = usePeople();
  const now = useNow();
  const navigate = useNavigate();
  const resolve = useResolveAttention();
  const openDm = useOpenDm();
  const setConnectComputerOpen = useUi((s) => s.setConnectComputerOpen);
  const setWizard = useUi((s) => s.setWizard);
  const [table, setTable] = useState(false);
  const [quick, setQuick] = useState('');
  const [quickAgent, setQuickAgent] = useState(0);

  const hour = new Date(now).getHours();
  const hello =
    hour < 12
      ? t('dashboard.greetingMorning')
      : hour < 18
        ? t('dashboard.greetingAfternoon')
        : t('dashboard.greetingEvening');
  const date = formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' });
  const live = tasks.filter((t) => t.activeRun && people.agent(t.assigneeId));
  const available = people.agents.filter((a) => a.status !== 'offline');
  const qa = available[quickAgent % Math.max(1, available.length)];
  const online = people.computers.filter((c) => c.status === 'online');

  const days = summary?.days ?? [];
  const n = days.length - 1;
  const today = n >= 0 ? days[n].completed + days[n].failed : 0;
  const yday = n >= 1 ? days[n - 1].completed + days[n - 1].failed : 0;
  const d7 = sum(days.slice(-7).map((d) => d.completed));
  const f7 = sum(days.slice(-7).map((d) => d.failed));
  const maxA = Math.max(1, ...(summary?.byAgent.map((x) => x.count) ?? [1]));

  const submitQuick = () => {
    const text = quick.trim();
    if (!text || !qa) return;
    openDm.mutate(qa.id, {
      onSuccess: async ({ chatId }) => {
        setQuick('');
        await api.post(`/chats/${chatId}/messages`, { markdown: text });
        await navigate({ to: '/chat/$chatId', params: { chatId } });
      },
    });
  };

  return (
    <main className="main">
      <div className="dash">
        <div className="dash-in">
          <div className="dash-top drag" data-tauri-drag-region>
            <div>
              <div className="dash-date">{date}</div>
              <h1>
                {hello}, {session?.user.name}.
              </h1>
            </div>
            <form
              className="quick"
              onSubmit={(e) => {
                e.preventDefault();
                submitQuick();
              }}
            >
              <input
                placeholder={t('dashboard.quickPlaceholder')}
                aria-label={t('dashboard.quickLabel')}
                autoComplete="off"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
              />
              {qa && (
                <button
                  type="button"
                  className="who-chip"
                  title={t('dashboard.changeAgent')}
                  onClick={() => setQuickAgent((i) => i + 1)}
                >
                  <AgentAvatar agent={qa} size={20} />
                  {qa.name}
                </button>
              )}
              <button
                className="go"
                title={t('dashboard.assign')}
                aria-label={t('dashboard.assign')}
                disabled={openDm.isPending}
              >
                <Icon name="arrow" size={16} />
              </button>
            </form>
          </div>

          <div className="live">
            <div className="live-head">
              <span className="pulse" />
              {t('dashboard.runningCount', { n: live.length })}
              <span
                className="link"
                style={{ marginLeft: 'auto' }}
                role="link"
                tabIndex={0}
                onClick={() => void navigate({ to: '/tasks' })}
              >
                {t('dashboard.openTasks')}
              </span>
            </div>
            {live.map((task) => {
              const a = people.agent(task.assigneeId)!;
              const step = currentStep(task);
              return (
                <div
                  key={task.id}
                  className="live-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/tasks', search: { task: task.id } })}
                >
                  <AgentAvatar agent={a} />
                  <div className="what">
                    <b>{task.title}</b>
                    <div>
                      {a.name} ·{' '}
                      {task.chatId ? chatLabel(rooms, task.chatId, t) : t('dashboard.tasksLabel')} ·{' '}
                      <code style={{ fontSize: 11.5 }}>
                        {step ? `${step.tool} · ${step.input}` : ''}
                      </code>
                    </div>
                    <div className="progress">
                      <i />
                    </div>
                  </div>
                  <span className="stage">
                    <span className="mini-spin" />
                    {t('dashboard.stageRunning')}
                  </span>
                  <span className="elapsed">{mmss(now - ms(task.activeRun!.startedAt))}</span>
                </div>
              );
            })}
            {!live.length && (
              <div className="empty-line" style={{ padding: '8px 12px 12px' }}>
                {t('dashboard.noAgentRunning')}
              </div>
            )}
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="lbl">
                <Icon name="zap" size={14} /> {t('dashboard.assignmentsToday')}
              </div>
              <div className="val">{today}</div>
              <div className={`delta ${today >= yday ? 'up' : ''}`}>
                {today >= yday ? '+' : ''}
                {today - yday} {t('dashboard.vsYesterday')}
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="check" size={14} /> {t('dashboard.completed7d')}
              </div>
              <div className="val">
                {d7 + f7
                  ? formatNumber((d7 / (d7 + f7)) * 100, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })
                  : '–'}
                <small>%</small>
              </div>
              <div className="delta">{t('dashboard.doneFailed', { done: d7, failed: f7 })}</div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="clock" size={14} /> {t('dashboard.agentsWorkedToday')}
              </div>
              <div className="val">
                {summary?.minutesToday ?? 0}
                <small> {t('dashboard.minutesUnit')}</small>
              </div>
              <div className="delta">
                {t('dashboard.avgPerTask', {
                  avg: today
                    ? formatNumber((summary?.minutesToday ?? 0) / today, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })
                    : 0,
                })}
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="monitor" size={14} /> {t('dashboard.machinesOnline')}
              </div>
              <div className="val">
                {online.length}
                <small>/{people.computers.length}</small>
              </div>
              <div className="delta">
                {t('dashboard.heartbeat', {
                  ago: online[0] ? ago(online[0].lastHeartbeatAt, now) : '–',
                })}
              </div>
            </div>
          </div>

          <div className="dgrid">
            <div className="dcard">
              <div className="dcard-h">
                <div>
                  <h3>{t('dashboard.assignments14d')}</h3>
                  <div className="sub">{t('dashboard.allRoomsDms')}</div>
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: C_DONE }} />
                    {t('dashboard.completedLegend')}
                  </span>
                  <span>
                    <i style={{ background: C_FAIL }} />
                    {t('dashboard.failedLegend')}
                  </span>
                  <button
                    className="icon-btn"
                    title={table ? t('dashboard.showChart') : t('dashboard.showTable')}
                    onClick={() => setTable((v) => !v)}
                  >
                    <Icon name={table ? 'chart' : 'table'} size={16} />
                  </button>
                </div>
              </div>
              {table ? <AssignmentsTable days={days} /> : <AssignmentsChart days={days} />}
            </div>
            <div className="dcard">
              <div className="dcard-h">
                <h3>{t('dashboard.attention')}</h3>
                <span className="sub">
                  {t('dashboard.attentionCount', {
                    n: summary?.attention.filter((x) => !x.resolved).length ?? 0,
                  })}
                </span>
              </div>
              {summary?.attention.map((x) => {
                const [icon, cls] = ATTN_ICON[x.kind];
                return (
                  <div key={x.id} className="attn">
                    <div className={`ico ${cls}`}>
                      <Icon name={icon} size={16} />
                    </div>
                    <div className="tx">
                      {x.title}
                      <div>{x.meta}</div>
                    </div>
                    {x.resolved ? (
                      <span className="done-note">
                        <Icon name="check" size={13} />{' '}
                        {t('dashboard.doneAction', { action: x.action.toLowerCase() })}
                      </span>
                    ) : (
                      <button
                        className="btn sm"
                        onClick={() =>
                          x.kind === 'offline' ? setConnectComputerOpen(true) : resolve.mutate(x.id)
                        }
                      >
                        {x.action}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dgrid3">
            <div className="dcard">
              <div className="dcard-h">
                <div>
                  <h3>{t('dashboard.agentsTitle')}</h3>
                  <div className="sub">{t('dashboard.assignments7d')}</div>
                </div>
                <span
                  className="link"
                  role="link"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/people' })}
                >
                  {t('dashboard.all')}
                </span>
              </div>
              {summary?.byAgent.map(({ agentId, count }) => {
                const a = people.agent(agentId);
                if (!a) return null;
                return (
                  <div key={agentId} className="hbar">
                    <div className="nm">
                      <AgentAvatar agent={a} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                      <Dot state={agentPresence(a.status)} />
                    </div>
                    <div className="track">
                      <div
                        className="bar"
                        style={{ width: `calc(${count / maxA} * (100% - 32px))` }}
                      />
                      <span className="v">{count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dcard">
              <div className="dcard-h">
                <h3>{t('dashboard.recentActivity')}</h3>
              </div>
              <ul className="feed">
                {summary?.feed.map((f) => (
                  <li key={f.id}>
                    <span className="d" />
                    <span>
                      <b style={{ fontWeight: 600 }}>{people.name(f.by)}</b>{' '}
                      <Inline text={f.text} />
                    </span>
                    <span className="t">{rel(f.at, now)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="dcard">
              <div className="dcard-h">
                <div>
                  <h3>{t('dashboard.channels')}</h3>
                  <div className="sub">
                    {t('dashboard.activeCount', {
                      on: connections.filter((c) => c.status === 'on').length,
                      total: connections.length,
                    })}
                  </div>
                </div>
                <span
                  className="link"
                  role="link"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/connections' })}
                >
                  {t('dashboard.manage')}
                </span>
              </div>
              {connections.map((c) => (
                <div key={c.id} className="conn-mini">
                  <ChannelLogo id={c.id} size={28} />
                  <div className="nm">
                    {c.name}
                    <div>
                      {c.status === 'on' ? `→ #${c.roomName}` : t('dashboard.notConnected')}
                    </div>
                  </div>
                  {c.status === 'on' ? (
                    <Dot state="on" />
                  ) : (
                    <button className="btn sm" onClick={() => setWizard(c.id)}>
                      {t('dashboard.connect')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

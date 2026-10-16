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
import { useOpenDm } from '../chat/chat.api';
import { chatLabel } from '../chat/chat.logic';
import { useRooms } from '../chat/chat.api';
import { useConnections } from '../connections/connections.api';
import { useTasks } from '../tasks/tasks.api';
import { C_DONE, C_FAIL, currentStep } from '../tasks/tasks.logic';
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
  const hello = hour < 12 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const date = new Date(now).toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
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
                placeholder="Giao việc nhanh cho agent…"
                aria-label="Giao việc nhanh"
                autoComplete="off"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
              />
              {qa && (
                <button
                  type="button"
                  className="who-chip"
                  title="Đổi agent"
                  onClick={() => setQuickAgent((i) => i + 1)}
                >
                  <AgentAvatar agent={qa} size={20} />
                  {qa.name}
                </button>
              )}
              <button
                className="go"
                title="Giao việc"
                aria-label="Giao việc"
                disabled={openDm.isPending}
              >
                <Icon name="arrow" size={16} />
              </button>
            </form>
          </div>

          <div className="live">
            <div className="live-head">
              <span className="pulse" />
              Đang chạy · {live.length}
              <span
                className="link"
                style={{ marginLeft: 'auto' }}
                role="link"
                tabIndex={0}
                onClick={() => void navigate({ to: '/tasks' })}
              >
                Mở board Tasks
              </span>
            </div>
            {live.map((t) => {
              const a = people.agent(t.assigneeId)!;
              const step = currentStep(t);
              return (
                <div
                  key={t.id}
                  className="live-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/tasks', search: { task: t.id } })}
                >
                  <AgentAvatar agent={a} />
                  <div className="what">
                    <b>{t.title}</b>
                    <div>
                      {a.name} · {t.chatId ? chatLabel(rooms, t.chatId) : 'Tasks'} ·{' '}
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
                    running
                  </span>
                  <span className="elapsed">{mmss(now - ms(t.activeRun!.startedAt))}</span>
                </div>
              );
            })}
            {!live.length && (
              <div className="empty-line" style={{ padding: '8px 12px 12px' }}>
                Không agent nào đang chạy.
              </div>
            )}
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="lbl">
                <Icon name="zap" size={14} /> Assignments hôm nay
              </div>
              <div className="val">{today}</div>
              <div className={`delta ${today >= yday ? 'up' : ''}`}>
                {today >= yday ? '+' : ''}
                {today - yday} so với hôm qua
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="check" size={14} /> Hoàn thành · 7 ngày
              </div>
              <div className="val">
                {d7 + f7 ? ((d7 / (d7 + f7)) * 100).toFixed(1).replace('.', ',') : '–'}
                <small>%</small>
              </div>
              <div className="delta">
                {d7} xong · {f7} lỗi
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="clock" size={14} /> Agent làm hôm nay
              </div>
              <div className="val">
                {summary?.minutesToday ?? 0}
                <small> phút</small>
              </div>
              <div className="delta">
                trung bình{' '}
                {today ? ((summary?.minutesToday ?? 0) / today).toFixed(1).replace('.', ',') : 0}{' '}
                phút mỗi việc
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">
                <Icon name="monitor" size={14} /> Máy online
              </div>
              <div className="val">
                {online.length}
                <small>/{people.computers.length}</small>
              </div>
              <div className="delta">
                heartbeat {online[0] ? ago(online[0].lastHeartbeatAt, now) : '–'}
              </div>
            </div>
          </div>

          <div className="dgrid">
            <div className="dcard">
              <div className="dcard-h">
                <div>
                  <h3>Assignments 14 ngày</h3>
                  <div className="sub">Mọi room và DM, theo ngày</div>
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: C_DONE }} />
                    Hoàn thành
                  </span>
                  <span>
                    <i style={{ background: C_FAIL }} />
                    Lỗi
                  </span>
                  <button
                    className="icon-btn"
                    title={table ? 'Xem biểu đồ' : 'Xem bảng'}
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
                <h3>Cần chú ý</h3>
                <span className="sub">
                  {summary?.attention.filter((x) => !x.resolved).length ?? 0} việc
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
                        <Icon name="check" size={13} /> Đã {x.action.toLowerCase()}
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
                  <h3>Agents</h3>
                  <div className="sub">Assignments 7 ngày</div>
                </div>
                <span
                  className="link"
                  role="link"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/people' })}
                >
                  Tất cả
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
                <h3>Hoạt động gần đây</h3>
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
                  <h3>Kênh kết nối</h3>
                  <div className="sub">
                    {connections.filter((c) => c.status === 'on').length}/{connections.length} đang
                    hoạt động
                  </div>
                </div>
                <span
                  className="link"
                  role="link"
                  tabIndex={0}
                  onClick={() => void navigate({ to: '/connections' })}
                >
                  Quản lý
                </span>
              </div>
              {connections.map((c) => (
                <div key={c.id} className="conn-mini">
                  <ChannelLogo id={c.id} size={28} />
                  <div className="nm">
                    {c.name}
                    <div>{c.status === 'on' ? `→ #${c.roomName}` : 'Chưa kết nối'}</div>
                  </div>
                  {c.status === 'on' ? (
                    <Dot state="on" />
                  ) : (
                    <button className="btn sm" onClick={() => setWizard(c.id)}>
                      Kết nối
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

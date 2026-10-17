import { currentStep, pickableOf, queueOf, runningOf, type RunSpan, type Task } from '@repo/shared';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Who } from '../../components/Who';
import { ago, dur, HOUR, hhmm, mmss, ms, MIN } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useT, type MessageKey } from '../../i18n';
import { ROLE_NAME, usePeople } from '../workspace/workspace.api';
import { useRunSpans } from './tasks.api';
import { PriorityIcon, StatusIcon } from './task-ui';
import { C_CANCEL, C_DONE, C_FAIL, C_RUN } from './tasks.logic';

const WINDOW = 8 * HOUR;
const COLOR: Record<RunSpan['result'], string> = { done: C_DONE, fail: C_FAIL, cancel: C_CANCEL };
const RESULT: Record<RunSpan['result'], MessageKey> = {
  done: 'tasks.result.done',
  fail: 'tasks.result.fail',
  cancel: 'tasks.result.cancel',
};

interface Tip {
  x: number;
  y: number;
  body: ReactNode;
}

/** "Theo Agent": an 8-hour lane of runs per agent, with current work and queue. */
export function WorkloadView({
  tasks,
  who,
  onOpen,
}: {
  tasks: Task[];
  who: string | null;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const people = usePeople();
  const spans = useRunSpans();
  const now = useNow();
  const [tip, setTip] = useState<Tip | null>(null);
  const w0 = now - WINDOW;
  const pos = (t: number) => Math.max(0, ((t - w0) / WINDOW) * 100);
  const ticks: number[] = [];
  for (let h = Math.ceil(w0 / HOUR) * HOUR; h < now - 20 * MIN; h += HOUR) ticks.push(h);

  const tipProps = (title: string, detail: string) => ({
    onMouseMove: (e: MouseEvent) =>
      setTip({
        x: Math.min(e.clientX + 14, window.innerWidth - 240),
        y: e.clientY - 56,
        body: (
          <>
            <b style={{ float: 'none', margin: 0 }}>{title}</b>
            <br />
            {detail}
          </>
        ),
      }),
    onMouseLeave: () => setTip(null),
  });

  const agents = people.agents.filter((a) => !who || who === a.id);
  const humans = people.members.filter(
    (m) =>
      (!who || who === m.id) && tasks.some((t) => t.assigneeId === m.id && t.status !== 'done'),
  );

  return (
    <div className="wl">
      <div className="wl-top">
        <div className="sub">{t('tasks.workload.hint')}</div>
        <div className="legend">
          <span>
            <i style={{ background: C_DONE }} />
            {t('tasks.result.done')}
          </span>
          <span>
            <i style={{ background: C_FAIL }} />
            {t('tasks.result.fail')}
          </span>
          <span>
            <i style={{ background: C_RUN }} />
            {t('tasks.legend.running')}
          </span>
          <span>
            <i style={{ background: C_CANCEL }} />
            {t('tasks.result.cancel')}
          </span>
          <span>
            <i
              style={{
                background:
                  'repeating-linear-gradient(135deg, var(--swatch-a) 0 2px, var(--swatch-b) 2px 3px)',
                border: '1px solid var(--swatch-line)',
              }}
            />
            {t('tasks.legend.offline')}
          </span>
        </div>
      </div>

      {agents.map((a) => {
        const cur = runningOf(tasks, a.id);
        const run = cur?.activeRun;
        const queue = queueOf(tasks, a.id);
        const pc = people.computerOf(a);
        const off = pc?.status !== 'online';
        const hist = spans.filter((s) => s.agentId === a.id && ms(s.endedAt) > w0);
        const busyMs =
          hist.reduce((sum, s) => sum + ms(s.endedAt) - Math.max(ms(s.startedAt), w0), 0) +
          (run ? now - ms(run.startedAt) : 0);
        const done = hist.filter((s) => s.result === 'done').length;
        const fail = hist.filter((s) => s.result === 'fail').length;
        const step = cur && currentStep(cur);
        return (
          <div key={a.id} className="wl-row">
            <div>
              <div className="wl-who">
                <span className="avw">
                  <AgentAvatar agent={a} />
                  <Dot state={off ? 'off' : cur ? 'busy' : 'on'} />
                </span>
                <div>
                  <h4>{a.name}</h4>
                  <div className="sub">
                    {off
                      ? t('tasks.workload.offlineCap')
                      : cur
                        ? t('tasks.workload.working')
                        : t('tasks.workload.idle')}{' '}
                    · {pc?.name}
                  </div>
                </div>
              </div>
              <div className="wl-stats">
                <span>
                  <b>{done}</b>
                  {t('tasks.workload.doneShort')}
                </span>
                <span>
                  <b>{fail}</b>
                  {t('tasks.workload.failShort')}
                </span>
                <span>
                  <b>{dur(Math.round(busyMs / 1000)).replace(/ \d+s$/, '')}</b>
                  {t('tasks.workload.ranFor')}
                </span>
                <span>
                  <b>{Math.round((busyMs / WINDOW) * 100)}%</b>
                  {t('tasks.workload.busy')}
                </span>
              </div>
            </div>
            <div>
              {cur && run && step ? (
                <div
                  className="wl-cur"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(cur.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpen(cur.id)}
                >
                  <span className="mini-spin" />
                  <div className="t">
                    <b>{cur.id}</b> · {cur.title}
                    <div>
                      {t('tasks.step', { n: run.step + 1, total: run.steps.length })} · {step.tool}{' '}
                      {step.input}
                    </div>
                  </div>
                  <span className="elapsed" style={{ color: 'var(--claude)', fontWeight: 600 }}>
                    {mmss(now - ms(run.startedAt))}
                  </span>
                </div>
              ) : (
                <div className={`wl-idle ${off ? 'off' : ''}`}>
                  {off ? (
                    <>
                      <Icon name="monitor" size={15} /> {t('tasks.workload.machine')}{' '}
                      <b>{pc?.name}</b> {t('tasks.workload.offline')}{' '}
                      {pc && ago(pc.lastHeartbeatAt, now)}
                      {t('tasks.workload.queueBlocked')}
                    </>
                  ) : (
                    <>
                      <Icon name="clock" size={15} /> {t('tasks.workload.idleNow')}
                      {pickableOf(tasks, a.id)[0] ? (
                        <>
                          {t('tasks.workload.willTake')}
                          <b>{pickableOf(tasks, a.id)[0].id}</b>
                          {t('tasks.workload.next')}
                        </>
                      ) : queue.length ? (
                        t('tasks.workload.queueNeedsReview')
                      ) : (
                        t('tasks.workload.queueEmpty')
                      )}
                    </>
                  )}
                </div>
              )}
              <div
                className="lane"
                role="img"
                aria-label={t('tasks.workload.laneAria', { name: a.name, done, fail })}
              >
                {hist.map((s, i) => (
                  <div
                    key={i}
                    className="blk"
                    style={{
                      left: `${pos(ms(s.startedAt))}%`,
                      width: `${((Math.min(ms(s.endedAt), now) - Math.max(ms(s.startedAt), w0)) / WINDOW) * 100}%`,
                      backgroundColor: COLOR[s.result],
                    }}
                    {...tipProps(
                      s.title,
                      `${hhmm(ms(s.startedAt))}–${hhmm(ms(s.endedAt))} · ${t(RESULT[s.result])}`,
                    )}
                  />
                ))}
                {cur && run && (
                  <div
                    className="blk run"
                    style={{
                      left: `${pos(ms(run.startedAt))}%`,
                      width: `${((now - ms(run.startedAt)) / WINDOW) * 100}%`,
                      backgroundColor: C_RUN,
                    }}
                    {...tipProps(
                      cur.title,
                      t('tasks.workload.runningFrom', { time: hhmm(ms(run.startedAt)) }),
                    )}
                  />
                )}
                {off && pc && (
                  <div className="offz" style={{ left: `${pos(ms(pc.lastHeartbeatAt))}%` }}>
                    {t('tasks.workload.offline')}
                  </div>
                )}
                <span className="now" />
              </div>
              <div className="axis">
                {ticks.map((h) => (
                  <span key={h} style={{ left: `${pos(h)}%` }}>
                    {hhmm(h)}
                  </span>
                ))}
              </div>
              <div className="wl-q">
                <span className="h">{t('tasks.workload.queueCount', { n: queue.length })}</span>
                {queue.map((t) => (
                  <span
                    key={t.id}
                    className="qchip"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
                  >
                    <PriorityIcon priority={t.priority} />
                    <span className="k">{t.id}</span>
                    <span>{t.title}</span>
                    {t.blockedReason && <Icon name="lock" size={12} />}
                  </span>
                ))}
                {!queue.length && <span className="h">{t('tasks.workload.empty')}</span>}
              </div>
            </div>
          </div>
        );
      })}

      {humans.length > 0 && (
        <>
          <div className="dsec" style={{ marginTop: 26 }}>
            {t('tasks.members')}
          </div>
          {humans.map((m) => (
            <div
              key={m.id}
              className="wl-row"
              style={{ gridTemplateColumns: '320px 1fr', alignItems: 'center' }}
            >
              <div className="wl-who">
                <span className="avw">
                  <Who id={m.id} size={40} />
                </span>
                <div>
                  <h4>{m.name}</h4>
                  <div className="sub">{ROLE_NAME[m.role]}</div>
                </div>
              </div>
              <div className="wl-q" style={{ margin: 0 }}>
                {tasks
                  .filter((t) => t.assigneeId === m.id && t.status !== 'done')
                  .map((t) => (
                    <span
                      key={t.id}
                      className="qchip"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(t.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
                    >
                      <StatusIcon status={t.status} size={13} />
                      <span className="k">{t.id}</span>
                      <span>{t.title}</span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
      {tip && (
        <div
          className="tip"
          style={{ position: 'fixed', display: 'block', left: tip.x, top: tip.y }}
        >
          {tip.body}
        </div>
      )}
    </div>
  );
}

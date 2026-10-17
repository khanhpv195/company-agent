import { DemoBadge } from '../../components/DemoBadge';
import { pickableOf, queueOf, runningOf, type Task } from '@repo/shared';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { Who } from '../../components/Who';
import { useT } from '../../i18n';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed } from './task-ui';

interface Props {
  tasks: Task[];
  who: string | null;
  onFilter: (id: string) => void;
  onOpen: (id: string) => void;
}

/** "Agents lúc này": what every agent is running right now. */
export function AgentStrip({ tasks, who, onFilter, onOpen }: Props) {
  const t = useT();
  const people = usePeople();
  const humans = people.members.filter((m) =>
    tasks.some((t) => t.assigneeId === m.id && t.status !== 'done'),
  );
  const humansDoing = tasks.filter(
    (t) => people.member(t.assigneeId) && t.status === 'doing',
  ).length;

  return (
    <div className="ag-strip" aria-label={t('tasks.strip.aria')}>
      {people.agents.map((a) => {
        const cur = runningOf(tasks, a.id);
        const queue = queueOf(tasks, a.id);
        const pc = people.computerOf(a);
        const off = pc?.status !== 'online';
        const blocked = queue.filter((t) => t.blockedReason).length;
        return (
          <button
            key={a.id}
            className={`ag ${cur ? 'working' : ''} ${who === a.id ? 'on' : who ? 'dim' : ''}`}
            title={t('tasks.filterBy', { name: a.name })}
            aria-pressed={who === a.id}
            onClick={() => onFilter(a.id)}
          >
            <span className="avw">
              <AgentAvatar agent={a} />
              <Dot state={off ? 'off' : cur ? 'busy' : 'on'} />
            </span>
            <span className="ag-tx">
              <div className="ag-n">
                {a.name}
                {a.simulated && <DemoBadge />}
              </div>
              <div className="ag-s">
                {cur ? (
                  <span
                    data-open-task={cur.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(cur.id);
                    }}
                  >
                    <b>{cur.id}</b> · {cur.title}
                  </span>
                ) : off ? (
                  `${t('tasks.strip.offline', { name: pc?.name ?? '' })}${blocked ? t('tasks.strip.blocked', { n: blocked }) : ''}`
                ) : pickableOf(tasks, a.id).length ? (
                  t('tasks.strip.idleNext')
                ) : queue.length ? (
                  t('tasks.strip.idleReview', { n: queue.length })
                ) : (
                  t('tasks.strip.idleEmpty')
                )}
              </div>
            </span>
            <span className="ag-r">
              {cur?.activeRun && <Elapsed since={cur.activeRun.startedAt} />}
              {queue.length} {t('tasks.strip.waiting')}
            </span>
          </button>
        );
      })}
      <div className="ag-humans">
        <span className="stack">
          {humans.map((m) => (
            <button
              key={m.id}
              className={who === m.id ? 'on' : ''}
              title={t('tasks.filterBy', { name: m.name })}
              onClick={() => onFilter(m.id)}
            >
              <Who id={m.id} size={26} />
            </button>
          ))}
        </span>
        <span>
          {t('tasks.members')}
          <br />
          {t('tasks.strip.doingCount', { n: humansDoing })}
        </span>
      </div>
    </div>
  );
}

import type { Task } from '@repo/shared';
import { AgentAvatar, Dot } from '../../components/Avatar';
import { Who } from '../../components/Who';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed } from './task-ui';
import { pickableOf, queueOf, runningOf } from './tasks.logic';

interface Props {
  tasks: Task[];
  who: string | null;
  onFilter: (id: string) => void;
  onOpen: (id: string) => void;
}

/** "Agents lúc này": what every agent is running right now. */
export function AgentStrip({ tasks, who, onFilter, onOpen }: Props) {
  const people = usePeople();
  const humans = people.members.filter((m) =>
    tasks.some((t) => t.assigneeId === m.id && t.status !== 'done'),
  );
  const humansDoing = tasks.filter(
    (t) => people.member(t.assigneeId) && t.status === 'doing',
  ).length;

  return (
    <div className="ag-strip" aria-label="Agents lúc này">
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
            title={`Lọc theo ${a.name}`}
            aria-pressed={who === a.id}
            onClick={() => onFilter(a.id)}
          >
            <span className="avw">
              <AgentAvatar agent={a} />
              <Dot state={off ? 'off' : cur ? 'busy' : 'on'} />
            </span>
            <span className="ag-tx">
              <div className="ag-n">{a.name}</div>
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
                  `Offline · ${pc?.name ?? ''}${blocked ? ` · ${blocked} việc bị chặn` : ''}`
                ) : pickableOf(tasks, a.id).length ? (
                  'Rảnh · sắp nhận việc tiếp'
                ) : queue.length ? (
                  `Rảnh · ${queue.length} việc cần xem lại`
                ) : (
                  'Rảnh · hàng đợi trống'
                )}
              </div>
            </span>
            <span className="ag-r">
              {cur?.activeRun && <Elapsed since={cur.activeRun.startedAt} />}
              {queue.length} chờ
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
              title={`Lọc theo ${m.name}`}
              onClick={() => onFilter(m.id)}
            >
              <Who id={m.id} size={26} />
            </button>
          ))}
        </span>
        <span>
          Thành viên
          <br />
          {humansDoing} đang làm
        </span>
      </div>
    </div>
  );
}

import { currentStep, type Task } from '@repo/shared';
import { Icon } from '../../components/Icon';
import { Who } from '../../components/Who';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';
import { COLUMNS, PRIORITIES } from './tasks.logic';

export function ListView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const people = usePeople();
  const now = useNow();
  const groups = COLUMNS.map((c) => ({ c, items: tasks.filter((t) => t.status === c.id) })).filter(
    (g) => g.items.length,
  );
  if (!groups.length)
    return (
      <div className="tlist">
        <div className="col-empty" style={{ marginTop: 24 }}>
          Không có task nào khớp bộ lọc
        </div>
      </div>
    );
  return (
    <div className="tlist">
      {groups.map(({ c, items }) => (
        <div key={c.id} role="group" aria-label={c.name}>
          <div className="tl-grp">
            <StatusIcon status={c.id} /> {c.name} <span className="n">{items.length}</span>
          </div>
          {items.map((t) => {
            const step = currentStep(t);
            return (
              <div
                key={t.id}
                className="tl-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(t.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
              >
                <StatusIcon status={t.status} />
                <span className="id">{t.id}</span>
                <span className="ttl">
                  <span>{t.title}</span>
                  {t.labels.map((l) => (
                    <Label key={l} name={l} />
                  ))}
                </span>
                <span className="who">
                  <Who id={t.assigneeId} /> {people.name(t.assigneeId)}
                </span>
                {t.activeRun && step ? (
                  <span className="st run">
                    <Elapsed since={t.activeRun.startedAt} className="" /> · {step.tool}{' '}
                    {step.input}
                  </span>
                ) : t.blockedReason ? (
                  <span className="st">
                    <Icon name="lock" size={12} /> {t.blockedReason}
                  </span>
                ) : t.error ? (
                  <span className="st" style={{ color: 'var(--err)' }}>
                    {t.error}
                  </span>
                ) : (
                  <span className="st">
                    {t.runs[0]
                      ? `Run gần nhất ${rel(t.runs[0].at, now)}`
                      : `Tạo ${rel(t.createdAt, now)}`}
                  </span>
                )}
                <span className="pr">
                  <PriorityIcon priority={t.priority} />
                  {PRIORITIES[t.priority]}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

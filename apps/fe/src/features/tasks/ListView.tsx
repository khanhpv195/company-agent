import { currentStep, type Task } from '@repo/shared';
import { Icon } from '../../components/Icon';
import { Who } from '../../components/Who';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useT } from '../../i18n';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';
import { COLUMNS, PRIORITY_KEYS } from './tasks.logic';

export function ListView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const t = useT();
  const people = usePeople();
  const now = useNow();
  const groups = COLUMNS.map((c) => ({
    c,
    items: tasks.filter((task) => task.status === c.id),
  })).filter((g) => g.items.length);
  if (!groups.length)
    return (
      <div className="tlist">
        <div className="col-empty" style={{ marginTop: 24 }}>
          {t('tasks.noMatch')}
        </div>
      </div>
    );
  return (
    <div className="tlist">
      {groups.map(({ c, items }) => (
        <div key={c.id} role="group" aria-label={t(c.nameKey)}>
          <div className="tl-grp">
            <StatusIcon status={c.id} /> {t(c.nameKey)} <span className="n">{items.length}</span>
          </div>
          {items.map((task) => {
            const step = currentStep(task);
            return (
              <div
                key={task.id}
                className="tl-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(task.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}
              >
                <StatusIcon status={task.status} />
                <span className="id">{task.id}</span>
                <span className="ttl">
                  <span>{task.title}</span>
                  {task.labels.map((l) => (
                    <Label key={l} name={l} />
                  ))}
                </span>
                <span className="who">
                  <Who id={task.assigneeId} /> {people.name(task.assigneeId)}
                </span>
                {task.activeRun && step ? (
                  <span className="st run">
                    <Elapsed since={task.activeRun.startedAt} className="" /> · {step.tool}{' '}
                    {step.input}
                  </span>
                ) : task.blockedReason ? (
                  <span className="st">
                    <Icon name="lock" size={12} /> {task.blockedReason}
                  </span>
                ) : task.error ? (
                  <span className="st" style={{ color: 'var(--err)' }}>
                    {task.error}
                  </span>
                ) : (
                  <span className="st">
                    {task.runs[0]
                      ? t('tasks.lastRun', { when: rel(task.runs[0].at, now) })
                      : t('tasks.createdAgo', { when: rel(task.createdAt, now) })}
                  </span>
                )}
                <span className="pr">
                  <PriorityIcon priority={task.priority} />
                  {t(PRIORITY_KEYS[task.priority])}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

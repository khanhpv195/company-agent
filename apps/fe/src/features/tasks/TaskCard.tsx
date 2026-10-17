import { currentStep, type Task } from '@repo/shared';
import { Icon } from '../../components/Icon';
import { Who } from '../../components/Who';
import { rel } from '../../lib/format';
import { useT } from '../../i18n';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';

interface Props {
  task: Task;
  selected: boolean;
  dragging: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function TaskCard({
  task,
  selected,
  dragging,
  onOpen,
  onApprove,
  onDragStart,
  onDragEnd,
}: Props) {
  const t = useT();
  const people = usePeople();
  const now = useNow();
  const agent = people.agent(task.assigneeId);
  const run = task.activeRun;
  const step = currentStep(task);
  const subsDone = task.subtasks.filter((s) => s.done).length;
  const comments = task.activity.filter((a) => a.kind === 'comment').length;
  const lastRun = task.runs[0];

  let note = null;
  if (run && step)
    note = (
      <>
        <div className="tc-live">
          <span className="mini-spin" />
          <span className="stp">
            {step.tool} · {step.input}
          </span>
          <Elapsed since={run.startedAt} />
        </div>
        <div
          className="tc-prog"
          title={t('tasks.step', { n: run.step + 1, total: run.steps.length })}
        >
          {run.steps.map((_, i) => (
            <i key={i} className={i < run.step ? 'd' : i === run.step ? 'c' : ''} />
          ))}
        </div>
      </>
    );
  else if (task.status === 'doing' && !agent && task.assigneeId)
    note = (
      <div className="tc-note hum">
        <Icon name="user" size={13} />{' '}
        {t('tasks.card.working', { name: people.name(task.assigneeId) })}
      </div>
    );
  else if (task.blockedReason)
    note = (
      <div className="tc-note blk">
        <Icon name="lock" size={13} /> {t('tasks.card.blocked', { reason: task.blockedReason })}
      </div>
    );
  else if (task.error)
    note = (
      <div className="tc-note err">
        <Icon name="alert" size={13} /> {task.error}
      </div>
    );
  else if (task.status === 'review')
    note = (
      <div className="tc-note rev">
        <span>{t('tasks.card.waitingApproval')}</span>
        <button
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          <Icon name="check" size={12} /> {t('tasks.approve')}
        </button>
      </div>
    );

  return (
    <div
      className={`tcard ${run ? 'run' : ''} ${task.status === 'done' ? 'done' : ''} ${selected ? 'sel' : ''} ${dragging ? 'drag' : ''}`}
      draggable
      data-task={task.id}
      role="button"
      tabIndex={0}
      aria-label={`${task.id} ${task.title}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="tc-top">
        <StatusIcon status={task.status} size={13} />
        <span className="tid">{task.id}</span>
        <span className="sp" />
        <PriorityIcon priority={task.priority} />
        <Who id={task.assigneeId} />
      </div>
      <div className="tc-title">{task.title}</div>
      {note}
      <div className="tc-foot">
        {task.labels.map((l) => (
          <Label key={l} name={l} />
        ))}
        {task.subtasks.length > 0 && (
          <span className="m">
            <Icon name="check" size={12} />
            {subsDone}/{task.subtasks.length}
          </span>
        )}
        {task.runs.length > 0 && (
          <span className="m" title={t('tasks.card.runsTip')}>
            <Icon name="zap" size={12} />
            {task.runs.length}
          </span>
        )}
        {comments > 0 && (
          <span className="m">
            <Icon name="chat" size={12} />
            {comments}
          </span>
        )}
        {task.status === 'done' && lastRun && (
          <span className="m" style={{ marginLeft: 'auto' }}>
            {rel(lastRun.at, now)}
          </span>
        )}
      </div>
    </div>
  );
}

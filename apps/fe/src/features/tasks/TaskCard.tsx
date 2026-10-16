import type { Task } from '@repo/shared';
import { Icon } from '../../components/Icon';
import { Who } from '../../components/Who';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';
import { currentStep } from './tasks.logic';

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
  task: t,
  selected,
  dragging,
  onOpen,
  onApprove,
  onDragStart,
  onDragEnd,
}: Props) {
  const people = usePeople();
  const now = useNow();
  const agent = people.agent(t.assigneeId);
  const run = t.activeRun;
  const step = currentStep(t);
  const subsDone = t.subtasks.filter((s) => s.done).length;
  const comments = t.activity.filter((a) => a.kind === 'comment').length;
  const lastRun = t.runs[0];

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
        <div className="tc-prog" title={`Bước ${run.step + 1}/${run.steps.length}`}>
          {run.steps.map((_, i) => (
            <i key={i} className={i < run.step ? 'd' : i === run.step ? 'c' : ''} />
          ))}
        </div>
      </>
    );
  else if (t.status === 'doing' && !agent && t.assigneeId)
    note = (
      <div className="tc-note hum">
        <Icon name="user" size={13} /> {people.name(t.assigneeId)} đang làm
      </div>
    );
  else if (t.blockedReason)
    note = (
      <div className="tc-note blk">
        <Icon name="lock" size={13} /> Bị chặn: {t.blockedReason}
      </div>
    );
  else if (t.error)
    note = (
      <div className="tc-note err">
        <Icon name="alert" size={13} /> {t.error}
      </div>
    );
  else if (t.status === 'review')
    note = (
      <div className="tc-note rev">
        <span>Chờ bạn duyệt</span>
        <button
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          <Icon name="check" size={12} /> Duyệt
        </button>
      </div>
    );

  return (
    <div
      className={`tcard ${run ? 'run' : ''} ${t.status === 'done' ? 'done' : ''} ${selected ? 'sel' : ''} ${dragging ? 'drag' : ''}`}
      draggable
      data-task={t.id}
      role="button"
      tabIndex={0}
      aria-label={`${t.id} ${t.title}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="tc-top">
        <StatusIcon status={t.status} size={13} />
        <span className="tid">{t.id}</span>
        <span className="sp" />
        <PriorityIcon priority={t.priority} />
        <Who id={t.assigneeId} />
      </div>
      <div className="tc-title">{t.title}</div>
      {note}
      <div className="tc-foot">
        {t.labels.map((l) => (
          <Label key={l} name={l} />
        ))}
        {t.subtasks.length > 0 && (
          <span className="m">
            <Icon name="check" size={12} />
            {subsDone}/{t.subtasks.length}
          </span>
        )}
        {t.runs.length > 0 && (
          <span className="m" title="Số run">
            <Icon name="zap" size={12} />
            {t.runs.length}
          </span>
        )}
        {comments > 0 && (
          <span className="m">
            <Icon name="chat" size={12} />
            {comments}
          </span>
        )}
        {t.status === 'done' && lastRun && (
          <span className="m" style={{ marginLeft: 'auto' }}>
            {rel(lastRun.at, now)}
          </span>
        )}
      </div>
    </div>
  );
}

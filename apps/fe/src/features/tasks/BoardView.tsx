import type { Task, TaskStatus } from '@repo/shared';
import { useState, type DragEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { useUi } from '../../stores/ui';
import { StatusIcon } from './task-ui';
import { TaskCard } from './TaskCard';
import { COLUMNS } from './tasks.logic';

interface Props {
  tasks: Task[];
  openId: string | undefined;
  onOpen: (id: string) => void;
  onApprove: (id: string) => void;
  onMove: (id: string, status: TaskStatus, beforeId: string | null) => void;
}

export function BoardView({ tasks, openId, onOpen, onApprove, onMove }: Props) {
  const t = useT();
  const openNewTask = useUi((s) => s.openNewTask);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    const id = dragging ?? e.dataTransfer.getData('text/plain');
    const before =
      (e.target as HTMLElement).closest<HTMLElement>('[data-task]')?.dataset.task ?? null;
    setDragging(null);
    setOver(null);
    if (id) onMove(id, status, before === id ? null : before);
  };

  return (
    <div className="board">
      {COLUMNS.map((c) => {
        const items = tasks.filter((t) => t.status === c.id);
        const overWip = !!c.wip && items.length > c.wip;
        return (
          <section
            key={c.id}
            className={`col ${over === c.id ? 'over' : ''}`}
            aria-label={t(c.nameKey)}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (over !== c.id) setOver(c.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setOver((o) => (o === c.id ? null : o));
            }}
            onDrop={(e) => drop(e, c.id)}
          >
            <div className="col-h">
              <StatusIcon status={c.id} />
              <span>{t(c.nameKey)}</span>
              <span
                className={`n ${overWip ? 'over' : ''}`}
                title={c.wip ? t('tasks.wipLimit', { n: c.wip }) : undefined}
              >
                {items.length}
                {c.wip ? `/${c.wip}` : ''}
              </span>
              <button
                className="icon-btn"
                title={t('tasks.addTo', { name: t(c.nameKey) })}
                onClick={() => openNewTask(c.id)}
              >
                <Icon name="plus" size={15} />
              </button>
            </div>
            <div className="col-b">
              {items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  selected={openId === t.id}
                  dragging={dragging === t.id}
                  onOpen={() => onOpen(t.id)}
                  onApprove={() => onApprove(t.id)}
                  onDragStart={() => setDragging(t.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
              {!items.length && (
                <div className="col-empty">
                  {c.hintKey ? t(c.hintKey) : t('tasks.empty')}
                  <br />
                  {t('tasks.dropHere')}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

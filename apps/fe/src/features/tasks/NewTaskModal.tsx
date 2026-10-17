import type { TaskPriority, TaskStatus } from '@repo/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { useUi } from '../../stores/ui';
import { usePeople } from '../workspace/workspace.api';
import { useTaskActions } from './tasks.api';
import { COLUMNS, PRIORITY_KEYS } from './tasks.logic';

export function NewTaskModal() {
  const status = useUi((s) => s.newTask);
  const close = useUi((s) => s.closeNewTask);
  if (!status) return null;
  return <NewTaskForm key={status} initialStatus={status} onClose={close} />;
}

function NewTaskForm({
  initialStatus,
  onClose,
}: {
  initialStatus: TaskStatus;
  onClose: () => void;
}) {
  const t = useT();
  const people = usePeople();
  const who = useUi((s) => s.taskFilters.who);
  const { create } = useTaskActions();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(
    who ?? (initialStatus === 'doing' ? (people.agents[0]?.id ?? '') : ''),
  );
  const [priority, setPriority] = useState<TaskPriority>('med');
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [requiresReview, setRequiresReview] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    if (!title.trim()) return setInvalid(true);
    create.mutate(
      { title, description, assigneeId: assigneeId || null, priority, status, requiresReview },
      {
        onSuccess: () => {
          onClose();
          void navigate({ to: '/tasks', search: (s) => s });
        },
      },
    );
  };

  return (
    <Modal onClose={onClose} label={t('tasks.newTask')}>
      <h3>{t('tasks.newTask')}</h3>
      <p>{t('tasks.newForm.lead')}</p>
      <input
        className="field"
        autoFocus
        placeholder={t('tasks.newForm.namePlaceholder')}
        aria-label={t('tasks.newForm.nameLabel')}
        autoComplete="off"
        value={title}
        style={invalid ? { borderColor: 'var(--err)' } : undefined}
        onChange={(e) => {
          setTitle(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <textarea
        className="field"
        style={{ height: 84, padding: '10px 14px', marginTop: 8, resize: 'none' }}
        placeholder={t('tasks.newForm.descPlaceholder')}
        aria-label={t('tasks.newForm.descLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="nt-grid">
        <label>
          {t('tasks.drawer.assignee')}
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('tasks.drawer.unassigned')}</option>
            <optgroup label={t('tasks.newForm.agents')}>
              {people.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status === 'offline'
                    ? t('tasks.drawer.offlineSuffix')
                    : a.status === 'working'
                      ? t('tasks.drawer.busySuffix')
                      : t('tasks.newForm.idleSuffix')}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('tasks.members')}>
              {people.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          {t('tasks.drawer.priority')}
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_KEYS).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('tasks.newForm.column')}
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {t(c.nameKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="nt-chk">
        <input
          type="checkbox"
          checked={requiresReview}
          onChange={(e) => setRequiresReview(e.target.checked)}
        />{' '}
        {t('tasks.newForm.requiresReview')}
      </label>
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('tasks.newForm.cancel')}
        </button>
        <button className="btn primary" onClick={submit} disabled={create.isPending}>
          {t('tasks.newForm.create')}
        </button>
      </div>
    </Modal>
  );
}

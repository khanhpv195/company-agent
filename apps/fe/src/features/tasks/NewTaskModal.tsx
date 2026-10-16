import type { TaskPriority, TaskStatus } from '@repo/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useUi } from '../../stores/ui';
import { usePeople } from '../workspace/workspace.api';
import { useTaskActions } from './tasks.api';
import { COLUMNS, PRIORITIES } from './tasks.logic';

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
    <Modal onClose={onClose} label="Task mới">
      <h3>Task mới</h3>
      <p>Giao cho agent thì task vào hàng đợi; agent rảnh sẽ tự nhận.</p>
      <input
        className="field"
        autoFocus
        placeholder="Ví dụ: Tóm tắt báo cáo doanh thu tuần này"
        aria-label="Tên task"
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
        placeholder="Mô tả, đầu ra mong muốn (không bắt buộc)"
        aria-label="Mô tả"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="nt-grid">
        <label>
          Người làm
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Chưa giao</option>
            <optgroup label="Agents">
              {people.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status === 'offline'
                    ? ' (offline)'
                    : a.status === 'working'
                      ? ' (đang bận)'
                      : ' (rảnh)'}
                </option>
              ))}
            </optgroup>
            <optgroup label="Thành viên">
              {people.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Ưu tiên
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cột
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        Cần người duyệt kết quả trước khi chuyển sang Xong
      </label>
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          Huỷ
        </button>
        <button className="btn primary" onClick={submit} disabled={create.isPending}>
          Tạo task
        </button>
      </div>
    </Modal>
  );
}

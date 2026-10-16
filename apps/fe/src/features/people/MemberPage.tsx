import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useTasks } from '../tasks/tasks.api';
import { StatusIcon } from '../tasks/task-ui';
import { ROLE_NAME, usePeople } from '../workspace/workspace.api';

const route = getRouteApi('/_app/people/members/$memberId');

export function MemberPage() {
  const { memberId } = route.useParams();
  const people = usePeople();
  const navigate = useNavigate();
  const tasks = (useTasks().data ?? []).filter(
    (t) => t.assigneeId === memberId && t.status !== 'done',
  );
  const m = people.member(memberId);
  if (!m)
    return (
      <div className="loading">
        {people.members.length ? 'Không tìm thấy thành viên.' : 'Đang tải…'}
      </div>
    );
  return (
    <div className="page">
      <div className="agent-hero">
        <MemberAvatar member={m} size={56} />
        <div>
          <h2>{m.name}</h2>
          <div className="lead" style={{ margin: 0 }}>
            {ROLE_NAME[m.role]} · {m.email}
          </div>
        </div>
      </div>
      <div className="box" style={{ maxWidth: 640 }}>
        <h4>Task đang giữ</h4>
        {tasks.length ? (
          <div className="wl-q" style={{ margin: 0 }}>
            {tasks.map((t) => (
              <span
                key={t.id}
                className="qchip"
                role="button"
                tabIndex={0}
                onClick={() => void navigate({ to: '/tasks', search: { task: t.id } })}
              >
                <StatusIcon status={t.status} size={13} />
                <span className="k">{t.id}</span>
                <span>{t.title}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Không có task nào.</div>
        )}
      </div>
      <button
        className="btn"
        style={{ marginTop: 16 }}
        disabled
        title="Nhắn tin giữa người với người (sắp có)"
      >
        <Icon name="chat" size={16} /> Nhắn tin
      </button>
    </div>
  );
}

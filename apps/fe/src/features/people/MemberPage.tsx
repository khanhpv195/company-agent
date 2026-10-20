import { MAX_TITLE, type Member } from '@repo/shared';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { useTasks } from '../tasks/tasks.api';
import { StatusIcon } from '../tasks/task-ui';
import { errorMessage } from '../../lib/error-message';
import { DepartmentSelect } from '../departments/DepartmentSelect';
import {
  useDepartments,
  useSetMemberDepartment,
  useSetMemberTitle,
} from '../departments/departments.api';
import { canEditTitle, cleanTitle, isTitleValid } from '../departments/departments.logic';
import { useNotify } from '../settings/settings.api';
import { ROLE_NAME, usePeople, useSession } from '../workspace/workspace.api';
import { useCanManage } from './people.api';

const route = getRouteApi('/_app/people/members/$memberId');

export function MemberPage() {
  const t = useT();
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
        {people.members.length ? t('people.member.notFound') : t('people.loading')}
      </div>
    );
  return (
    <div className="page">
      <div className="agent-hero">
        <MemberAvatar member={m} size={56} />
        <div>
          <h2>{m.name}</h2>
          <div className="lead" style={{ margin: 0 }}>
            {m.title ? `${m.title} · ` : ''}
            {ROLE_NAME[m.role]} · {m.email}
          </div>
        </div>
      </div>
      <MemberDetails key={m.id} member={m} />
      <div className="box" style={{ maxWidth: 640, marginTop: 14 }}>
        <h4>{t('people.member.holding')}</h4>
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
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('people.member.noTasks')}</div>
        )}
      </div>
      <button
        className="btn"
        style={{ marginTop: 16 }}
        disabled
        title={t('people.member.messageSoon')}
      >
        <Icon name="chat" size={16} /> {t('people.message')}
      </button>
    </div>
  );
}

/** Department (owner/admin) and job title (owner/admin, or the member themselves). */
function MemberDetails({ member }: { member: Member }) {
  const t = useT();
  const notify = useNotify();
  const me = useSession().data?.user;
  const manager = useCanManage();
  const departments = useDepartments();
  const setDepartment = useSetMemberDepartment();
  const isSelf = me?.id === member.id;
  const setTitle = useSetMemberTitle(isSelf);
  const mayTitle = !!me && canEditTitle(me, member.id);
  const [editing, setEditing] = useState(false);
  const [departmentId, setDepartmentId] = useState<string | null>(member.departmentId);
  const [title, setTitleDraft] = useState(member.title ?? '');
  const titleOk = isTitleValid(title);
  const pending = setDepartment.isPending || setTitle.isPending;
  const error = setDepartment.error ?? setTitle.error;

  const open = () => {
    setDepartment.reset();
    setTitle.reset();
    setDepartmentId(member.departmentId);
    setTitleDraft(member.title ?? '');
    setEditing(true);
  };
  const save = async () => {
    if (!titleOk || pending) return;
    try {
      if (manager && departmentId !== member.departmentId)
        await setDepartment.mutateAsync({ id: member.id, departmentId });
      const next = cleanTitle(title);
      if (mayTitle && next !== member.title)
        await setTitle.mutateAsync({ id: member.id, title: next });
      notify(t('departments.saved'));
      setEditing(false);
    } catch {
      /* the error line below shows it */
    }
  };

  return (
    <div className="box" style={{ maxWidth: 640 }}>
      <h4 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {t('people.member.details')}
        {!editing && (manager || mayTitle) && (
          <button className="btn sm" onClick={open}>
            {t('people.edit')}
          </button>
        )}
      </h4>
      {editing ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {manager && (
            <label>
              {t('departments.department')}
              <DepartmentSelect
                label={t('departments.department')}
                value={departmentId}
                onChange={setDepartmentId}
              />
            </label>
          )}
          {mayTitle && (
            <label>
              {t('departments.title')}
              <input
                className="field"
                aria-label={t('departments.title')}
                aria-invalid={!titleOk || undefined}
                placeholder={t('departments.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitleDraft(e.target.value)}
              />
            </label>
          )}
          {!titleOk && (
            <div className="err-line" style={{ marginTop: 0 }}>
              {t('departments.titleTooLong', { max: MAX_TITLE })}
            </div>
          )}
          {error && (
            <div className="err-line" style={{ marginTop: 0 }} role="alert">
              {errorMessage(error, t, 'departments.saveFailed')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn primary"
              disabled={!titleOk || pending}
              onClick={() => void save()}
            >
              {t('people.save')}
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              {t('people.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <dl className="kv">
          <dt>{t('departments.department')}</dt>
          <dd>{departments.byId(member.departmentId)?.name ?? t('departments.none')}</dd>
          <dt>{t('departments.title')}</dt>
          <dd>{member.title ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}

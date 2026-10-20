import {
  DEFAULT_DEPARTMENT_ICON,
  DEPARTMENT_ICONS,
  MAX_DEPARTMENT_NAME,
  type Department,
  type DepartmentIcon,
} from '@repo/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/error-message';
import {
  useCreateDepartment,
  useDeleteDepartment,
  useDepartments,
  useReorderDepartments,
  useUpdateDepartment,
} from '../departments/departments.api';
import {
  departmentCounts,
  isDepartmentNameTaken,
  isDepartmentNameValid,
  moveId,
} from '../departments/departments.logic';
import { useAgents, useMembers } from '../workspace/workspace.api';
import { useNotify } from './settings.api';

export function TeamSection() {
  const t = useT();
  const { list } = useDepartments();
  const members = useMembers();
  const agents = useAgents();
  const reorder = useReorderDepartments();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const ids = list.map((d) => d.id);

  return (
    <div className="set-stack wide">
      <div className="box set-box wide">
        <div className="set-head">
          <h4>{t('settings.team.listTitle', { count: list.length })}</h4>
        </div>
        {list.length === 0 && <div className="set-empty">{t('settings.team.empty')}</div>}
        <ul className="session-list">
          {list.map((d, i) => {
            const counts = departmentCounts(d.id, agents, members);
            return (
              <li key={d.id} className="dept-row">
                {editing === d.id ? (
                  <EditRow department={d} onDone={() => setEditing(null)} />
                ) : deleting === d.id ? (
                  <DeleteConfirm department={d} onDone={() => setDeleting(null)} />
                ) : (
                  <>
                    <span className="dept-ico">
                      <Icon name={d.icon} size={18} />
                    </span>
                    <div className="grow">
                      <div className="dev">{d.name}</div>
                      <div className="when">
                        {t('settings.team.members', { n: counts.members })} ·{' '}
                        {t('settings.team.agents', { n: counts.agents })}
                        {d.roomId ? (
                          <>
                            {' · '}
                            <Link className="link" to="/chat/$roomId" params={{ roomId: d.roomId }}>
                              {t('departments.openRoom')}
                            </Link>
                          </>
                        ) : (
                          ` · ${t('departments.noRoom')}`
                        )}
                      </div>
                    </div>
                    <button
                      className="icon-btn"
                      title={t('settings.team.moveUp', { name: d.name })}
                      aria-label={t('settings.team.moveUp', { name: d.name })}
                      disabled={i === 0 || reorder.isPending}
                      onClick={() => reorder.mutate(moveId(ids, d.id, -1))}
                    >
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      title={t('settings.team.moveDown', { name: d.name })}
                      aria-label={t('settings.team.moveDown', { name: d.name })}
                      disabled={i === list.length - 1 || reorder.isPending}
                      onClick={() => reorder.mutate(moveId(ids, d.id, 1))}
                    >
                      ↓
                    </button>
                    <button className="btn" onClick={() => setEditing(d.id)}>
                      {t('settings.team.edit')}
                    </button>
                    <button className="btn" onClick={() => setDeleting(d.id)}>
                      {t('settings.team.delete')}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {reorder.error && (
          <div className="err-line" role="alert">
            {errorMessage(reorder.error, t, 'settings.team.reorderFailed')}
          </div>
        )}
      </div>
      <NewDepartmentBox />
    </div>
  );
}

function IconPicker({
  value,
  onChange,
}: {
  value: DepartmentIcon;
  onChange: (icon: DepartmentIcon) => void;
}) {
  const t = useT();
  return (
    <div className="chips dept-icons" role="group" aria-label={t('departments.icon')}>
      {DEPARTMENT_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          className={`chip ${value === icon ? 'on' : ''}`}
          aria-pressed={value === icon}
          aria-label={t('departments.iconAria', { name: icon })}
          title={icon}
          onClick={() => onChange(icon)}
        >
          <Icon name={icon} size={15} />
        </button>
      ))}
    </div>
  );
}

/** Message for the name field, or null when the name can be saved. */
function useNameError(name: string, exceptId?: string) {
  const t = useT();
  const { list } = useDepartments();
  if (!isDepartmentNameValid(name))
    return t('settings.team.nameInvalid', { max: MAX_DEPARTMENT_NAME });
  if (isDepartmentNameTaken(list, name, exceptId)) return t('settings.team.nameTaken');
  return null;
}

function NewDepartmentBox() {
  const t = useT();
  const notify = useNotify();
  const create = useCreateDepartment();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<DepartmentIcon>(DEFAULT_DEPARTMENT_ICON);
  const nameError = useNameError(name);
  // Stay quiet until something is typed; the button is disabled meanwhile.
  const showError = name.trim().length > 0 && nameError;
  return (
    <form
      className="box set-box wide"
      onSubmit={(e) => {
        e.preventDefault();
        if (nameError) return;
        create.mutate(
          { name: name.trim(), icon },
          {
            onSuccess: () => {
              setName('');
              setIcon(DEFAULT_DEPARTMENT_ICON);
              notify(t('settings.team.created'));
            },
          },
        );
      }}
    >
      <h4>{t('settings.team.newTitle')}</h4>
      <label htmlFor="dept-name">{t('settings.team.name')}</label>
      <input
        id="dept-name"
        className="field"
        autoComplete="off"
        maxLength={MAX_DEPARTMENT_NAME + 20}
        placeholder={t('settings.team.namePlaceholder')}
        value={name}
        aria-invalid={!!showError || undefined}
        onChange={(e) => setName(e.target.value)}
      />
      {showError && (
        <div className="err-line" role="alert">
          {nameError}
        </div>
      )}
      <label style={{ marginTop: 14 }}>{t('departments.icon')}</label>
      <IconPicker value={icon} onChange={setIcon} />
      {create.error && (
        <div className="err-line" role="alert">
          {errorMessage(create.error, t, 'settings.team.createFailed')}
        </div>
      )}
      <div className="set-row">
        <button className="btn primary" disabled={!!nameError || create.isPending}>
          {t('settings.team.add')}
        </button>
      </div>
    </form>
  );
}

function EditRow({ department, onDone }: { department: Department; onDone: () => void }) {
  const t = useT();
  const notify = useNotify();
  const update = useUpdateDepartment();
  const [name, setName] = useState(department.name);
  const [icon, setIcon] = useState<DepartmentIcon>(department.icon);
  const nameError = useNameError(name, department.id);
  const changed = name.trim() !== department.name || icon !== department.icon;
  const save = () => {
    if (nameError) return;
    if (!changed) return onDone();
    update.mutate(
      {
        id: department.id,
        ...(name.trim() !== department.name ? { name: name.trim() } : null),
        ...(icon !== department.icon ? { icon } : null),
      },
      {
        onSuccess: () => {
          notify(t('settings.team.updated'));
          onDone();
        },
      },
    );
  };
  return (
    <div className="grow dept-edit">
      <input
        className="field"
        autoFocus
        aria-label={t('settings.team.name')}
        maxLength={MAX_DEPARTMENT_NAME + 20}
        value={name}
        aria-invalid={!!nameError || undefined}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      {nameError && (
        <div className="err-line" role="alert">
          {nameError}
        </div>
      )}
      <IconPicker value={icon} onChange={setIcon} />
      {update.error && (
        <div className="err-line" role="alert">
          {errorMessage(update.error, t, 'settings.team.updateFailed')}
        </div>
      )}
      <div className="set-row">
        <button className="btn primary" disabled={!!nameError || update.isPending} onClick={save}>
          {t('settings.team.save')}
        </button>
        <button className="btn" onClick={onDone}>
          {t('settings.team.cancel')}
        </button>
      </div>
    </div>
  );
}

function DeleteConfirm({ department, onDone }: { department: Department; onDone: () => void }) {
  const t = useT();
  const notify = useNotify();
  const remove = useDeleteDepartment();
  return (
    <div
      className="grow dept-edit"
      role="alertdialog"
      aria-label={t('settings.team.deleteConfirm')}
    >
      <div className="dev">{t('settings.team.deleteTitle', { name: department.name })}</div>
      <div className="when">{t('settings.team.deleteBody')}</div>
      {remove.error && (
        <div className="err-line" role="alert">
          {errorMessage(remove.error, t, 'settings.team.deleteFailed')}
        </div>
      )}
      <div className="set-row">
        <button
          className="btn danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(department.id, {
              onSuccess: () => {
                notify(t('settings.team.deleted'));
                onDone();
              },
            })
          }
        >
          {t('settings.team.deleteConfirm')}
        </button>
        <button className="btn" onClick={onDone}>
          {t('settings.team.cancel')}
        </button>
      </div>
    </div>
  );
}

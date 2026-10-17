import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { clearTokens } from '../../lib/auth-tokens';
import { errorMessage } from '../../lib/error-message';
import { useSession } from '../workspace/workspace.api';
import { useNotify } from './settings.api';
import { confirmNameMatches, isWorkspaceNameValid } from './settings.logic';
import { useDeleteWorkspace, useRenameWorkspace } from './team.api';

export function WorkspaceSection() {
  const role = useSession().data?.user.role;
  return (
    <div className="set-stack">
      <RenameBox />
      {role === 'owner' && <DeleteBox />}
    </div>
  );
}

function RenameBox() {
  const t = useT();
  const notify = useNotify();
  const saved = useSession().data?.workspace.name ?? '';
  const rename = useRenameWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? saved;
  const changed = name.trim() !== saved;
  const ready = changed && isWorkspaceNameValid(name);
  return (
    <form
      className="box set-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        rename.mutate(
          { name: name.trim() },
          {
            onSuccess: () => {
              setDraft(null);
              notify(t('settings.workspace.saved'));
            },
          },
        );
      }}
    >
      <h4>{t('settings.workspace.nameTitle')}</h4>
      <p className="sub">{t('settings.workspace.nameLead')}</p>
      <label htmlFor="ws-name">{t('settings.workspace.name')}</label>
      <input
        id="ws-name"
        className="field"
        maxLength={80}
        value={name}
        aria-invalid={(!isWorkspaceNameValid(name) && changed) || !!rename.error || undefined}
        aria-describedby={rename.error ? 'ws-error' : undefined}
        onChange={(e) => setDraft(e.target.value)}
      />
      {rename.error && (
        <div id="ws-error" className="err-line" role="alert">
          {errorMessage(rename.error, t, 'settings.workspace.saveFailed')}
        </div>
      )}
      <div className="set-row">
        <button className="btn primary" disabled={!ready || rename.isPending}>
          {t('settings.profile.save')}
        </button>
      </div>
    </form>
  );
}

function DeleteBox() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="box set-box">
      <h4>{t('settings.workspace.dangerTitle')}</h4>
      <p className="sub">{t('settings.workspace.dangerLead')}</p>
      <button className="btn danger" onClick={() => setOpen(true)}>
        {t('settings.workspace.dangerButton')}
      </button>
      {open && <DeleteModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const workspaceName = useSession().data?.workspace.name ?? '';
  const del = useDeleteWorkspace();
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const ready = confirmNameMatches(confirmName, workspaceName) && password.length > 0;
  return (
    <Modal onClose={onClose} label={t('settings.workspace.deleteTitle')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          del.mutate(
            { password, confirmName: confirmName.trim() },
            {
              onSuccess: async () => {
                // Leave first: a stale session query must not refetch into a 401 "session expired" toast.
                await navigate({ to: '/login' });
                await qc.cancelQueries();
                qc.clear();
                clearTokens();
                notify(t('settings.workspace.deleted'));
              },
            },
          );
        }}
      >
        <h3>{t('settings.workspace.deleteTitle')}</h3>
        <p>{t('settings.workspace.deleteBody', { name: workspaceName })}</p>
        <label htmlFor="wsd-name">
          {t('settings.workspace.deleteTypeName', { name: workspaceName })}
        </label>
        <input
          id="wsd-name"
          className="field"
          name="confirm-workspace-name"
          autoComplete="off"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />
        <label htmlFor="wsd-password">{t('settings.members.yourPassword')}</label>
        <input
          id="wsd-password"
          className="field"
          name="confirm-workspace-password"
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={!!del.error || undefined}
          aria-describedby={del.error ? 'wsd-error' : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {del.error && (
          <div id="wsd-error" className="err-line" role="alert">
            {errorMessage(del.error, t, 'settings.workspace.deleteFailed')}
          </div>
        )}
        <div className="set-row end">
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.security.cancel')}
          </button>
          <button className="btn danger" disabled={!ready || del.isPending}>
            {t('settings.workspace.deleteConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

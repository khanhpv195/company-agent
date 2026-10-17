import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { formatRelativeSeconds, useT } from '../../i18n';
import { ApiError } from '../../lib/api-client';
import { clearTokens } from '../../lib/auth-tokens';
import { errorMessage } from '../../lib/error-message';
import { useNow } from '../../lib/use-now';
import { isPasswordOk, passwordIssue } from '../auth/auth.logic';
import { useSession } from '../workspace/workspace.api';
import {
  useAccountSessions,
  useChangePassword,
  useDeleteAccount,
  useNotify,
  useRevokeOtherSessions,
  useRevokeSession,
} from './settings.api';
import { deviceLabel } from './settings.logic';

export function SecuritySection() {
  return (
    <div className="set-stack">
      <ChangePasswordBox />
      <SessionsBox />
      <DeleteAccountBox />
    </div>
  );
}

function ChangePasswordBox() {
  const t = useT();
  const email = useSession().data?.user.email;
  const notify = useNotify();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const issue = passwordIssue(next, email);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && isPasswordOk(next, email) && confirm === next;

  return (
    <form
      className="box set-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        change.mutate(
          { currentPassword: current, newPassword: next },
          {
            onSuccess: () => {
              setCurrent('');
              setNext('');
              setConfirm('');
              notify(t('settings.security.changed'));
            },
          },
        );
      }}
    >
      <h4>{t('settings.security.passwordTitle')}</h4>
      <p className="sub">{t('settings.security.passwordLead')}</p>
      <label htmlFor="sec-current">{t('settings.security.current')}</label>
      <input
        id="sec-current"
        className="field"
        type="password"
        autoComplete="current-password"
        value={current}
        aria-invalid={!!change.error || undefined}
        aria-describedby={change.error ? 'sec-error' : undefined}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <label htmlFor="sec-new">{t('settings.security.newPassword')}</label>
      <input
        id="sec-new"
        className="field"
        type="password"
        autoComplete="new-password"
        maxLength={128}
        value={next}
        aria-invalid={!!issue || undefined}
        aria-describedby="sec-new-msg"
        onChange={(e) => setNext(e.target.value)}
      />
      {issue ? (
        <div id="sec-new-msg" className="err-line" role="alert">
          {t(`auth.password.${issue}`)}
        </div>
      ) : (
        <div id="sec-new-msg" className="field-hint" aria-live="polite">
          {t('auth.password.hint')}
        </div>
      )}
      <label htmlFor="sec-confirm">{t('settings.security.confirm')}</label>
      <input
        id="sec-confirm"
        className="field"
        type="password"
        autoComplete="new-password"
        value={confirm}
        aria-invalid={mismatch || undefined}
        aria-describedby={mismatch ? 'sec-confirm-msg' : undefined}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {mismatch && (
        <div id="sec-confirm-msg" className="err-line" role="alert">
          {t('auth.password.mismatch')}
        </div>
      )}
      {change.error && (
        <div id="sec-error" className="err-line" role="alert">
          {errorMessage(change.error, t, 'settings.security.changeFailed')}
        </div>
      )}
      <div className="set-row">
        <button className="btn primary" disabled={!ready || change.isPending}>
          {t('settings.security.submit')}
        </button>
      </div>
    </form>
  );
}

function SessionsBox() {
  const t = useT();
  const notify = useNotify();
  const sessions = useAccountSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const list = sessions.data ?? [];
  const now = useNow();

  return (
    <div className="box set-box">
      <h4>{t('settings.security.sessionsTitle')}</h4>
      <p className="sub">{t('settings.security.sessionsLead')}</p>
      {sessions.isSuccess && list.length === 0 && (
        <div className="set-empty">{t('settings.security.noSessions')}</div>
      )}
      <ul className="session-list">
        {list.map((s) => {
          const ago = formatRelativeSeconds(Math.max(0, (now - Date.parse(s.lastUsedAt)) / 1000));
          return (
            <li key={s.id}>
              <div className="grow">
                <div className="dev">
                  {deviceLabel(s.userAgent) ?? t('settings.security.unknownDevice')}
                  {s.current && (
                    <span className="pill ok this">{t('settings.security.thisDevice')}</span>
                  )}
                </div>
                <div className="when">
                  {t('settings.security.lastUsed', { ago })}
                  {s.ip ? ` · ${t('settings.security.ip', { ip: s.ip })}` : ''}
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(s.id, { onSuccess: () => notify(t('settings.security.revoked')) })
                  }
                >
                  {t('settings.security.revoke')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {list.some((s) => !s.current) && (
        <div className="set-row">
          <button
            className="btn"
            disabled={revokeOthers.isPending}
            onClick={() =>
              revokeOthers.mutate(undefined, {
                onSuccess: () => notify(t('settings.security.revokedOthers')),
              })
            }
          >
            {t('settings.security.revokeOthers')}
          </button>
        </div>
      )}
    </div>
  );
}

function DeleteAccountBox() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="box set-box">
      <h4>{t('settings.security.dangerTitle')}</h4>
      <p className="sub">{t('settings.security.dangerLead')}</p>
      <button className="btn danger" onClick={() => setOpen(true)}>
        {t('settings.security.dangerButton')}
      </button>
      {open && <DeleteAccountModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const del = useDeleteAccount();
  // 409 means the owner has to hand the workspace over first; say how, not just "conflict".
  const message =
    del.error instanceof ApiError && del.error.status === 409
      ? t('settings.security.deleteOwner')
      : del.error?.message;

  return (
    <Modal onClose={onClose} label={t('settings.security.deleteTitle')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!password) return;
          del.mutate(
            { password },
            {
              onSuccess: async () => {
                // Same order as workspace delete: leave before dropping the session's cache and tokens.
                await navigate({ to: '/login' });
                await qc.cancelQueries();
                qc.clear();
                clearTokens();
              },
            },
          );
        }}
      >
        <h3>{t('settings.security.deleteTitle')}</h3>
        <p>{t('settings.security.deleteBody')}</p>
        <label htmlFor="del-password">{t('settings.security.deletePassword')}</label>
        <input
          id="del-password"
          className="field"
          name="confirm-account-password"
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={!!message || undefined}
          aria-describedby={message ? 'del-error' : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {message && (
          <div id="del-error" className="err-line" role="alert">
            {message}
          </div>
        )}
        <div className="set-row end">
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.security.cancel')}
          </button>
          <button className="btn danger" disabled={!password || del.isPending}>
            {t('settings.security.deleteConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

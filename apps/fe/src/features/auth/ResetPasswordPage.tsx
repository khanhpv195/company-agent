import type { ResetPasswordInput } from '@repo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api-client';
import { clearTokens } from '../../lib/auth-tokens';
import { errorMessage } from '../../lib/error-message';
import { AuthShell } from './AuthShell';
import { cleanToken, isPasswordOk, passwordIssue } from './auth.logic';

const route = getRouteApi('/reset-password');

export function ResetPasswordPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token: urlToken } = route.useSearch();
  // Keep the link token in state, then drop it from the URL so it does not linger in history.
  const [linkToken] = useState(urlToken);
  const [code, setCode] = useState(linkToken ?? '');
  useEffect(() => {
    if (urlToken) void navigate({ to: '/reset-password', search: {}, replace: true });
  }, [urlToken, navigate]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = useMutation({
    meta: { silentError: true },
    mutationFn: (input: ResetPasswordInput) => api.post<null>('/auth/reset-password', input),
    onSuccess: () => {
      // The API signed every session out; drop any local one instead of waiting for a 401.
      clearTokens();
      qc.clear();
    },
  });
  const issue = passwordIssue(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  // A link token needs no field; a rejected one (or none at all) asks for a pasted code.
  const showCode = !linkToken || reset.isError;
  const ready = cleanToken(code).length > 0 && isPasswordOk(password) && confirm === password;

  if (reset.isSuccess)
    return (
      <AuthShell title={t('auth.reset.doneTitle')}>
        <p className="auth-lead">{t('auth.reset.doneBody')}</p>
        <Link className="btn-olive auth-link-btn" to="/login">
          {t('auth.reset.toLogin')}
        </Link>
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('auth.reset.title')}
      lead={t('auth.reset.lead')}
      footer={
        <>
          {t('auth.reset.needNewLink')}{' '}
          <Link to="/forgot-password">{t('auth.reset.requestNew')}</Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) reset.mutate({ token: cleanToken(code), newPassword: password });
        }}
      >
        {showCode && (
          <>
            <label htmlFor="rp-code">{t('auth.reset.code')}</label>
            <input
              id="rp-code"
              className="field"
              autoComplete="one-time-code"
              spellCheck={false}
              placeholder={t('auth.reset.codePlaceholder')}
              value={code}
              aria-invalid={reset.isError || undefined}
              aria-describedby={reset.isError ? 'rp-error' : undefined}
              onChange={(e) => setCode(e.target.value)}
            />
          </>
        )}
        <label htmlFor="rp-password" style={showCode ? { marginTop: 14 } : undefined}>
          {t('auth.reset.newPassword')}
        </label>
        <input
          id="rp-password"
          className="field"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          aria-invalid={!!issue || undefined}
          aria-describedby="rp-password-msg"
          onChange={(e) => setPassword(e.target.value)}
        />
        {issue ? (
          <div id="rp-password-msg" className="err-line" role="alert">
            {t(`auth.password.${issue}`)}
          </div>
        ) : (
          <div id="rp-password-msg" className="field-hint" aria-live="polite">
            {t('auth.password.hint')}
          </div>
        )}
        <label htmlFor="rp-confirm" style={{ marginTop: 14 }}>
          {t('auth.reset.confirm')}
        </label>
        <input
          id="rp-confirm"
          className="field"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? 'rp-confirm-msg' : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && (
          <div id="rp-confirm-msg" className="err-line" role="alert">
            {t('auth.password.mismatch')}
          </div>
        )}
        {reset.error && (
          <div id="rp-error" className="err-line" role="alert">
            {errorMessage(reset.error, t, 'auth.reset.failed')}
          </div>
        )}
        <button className="btn-olive" disabled={reset.isPending || !ready}>
          {t('auth.reset.submit')}&nbsp;&nbsp;›
        </button>
      </form>
    </AuthShell>
  );
}

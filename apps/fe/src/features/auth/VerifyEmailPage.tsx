import type { VerifyEmailInput } from '@repo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api-client';
import { getTokens } from '../../lib/auth-tokens';
import { errorMessage } from '../../lib/error-message';
import { qk } from '../../lib/query-keys';
import { AuthShell } from './AuthShell';
import { cleanToken } from './auth.logic';

const route = getRouteApi('/verify-email');

/** Public on purpose: the emailed link must work with or without a signed-in session. */
export function VerifyEmailPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token: urlToken } = route.useSearch();
  // Keep the link token in state, then drop it from the URL so it does not linger in history.
  const [linkToken] = useState(urlToken);
  const [code, setCode] = useState('');
  const signedIn = !!getTokens();
  const verify = useMutation({
    meta: { silentError: true },
    mutationFn: (input: VerifyEmailInput) => api.post<null>('/auth/verify-email', input),
    onSuccess: () => {
      if (signedIn) void qc.invalidateQueries({ queryKey: qk.session });
    },
    onError: () => {
      // A failed verify may mean the signed-in user is already verified: refresh the session
      // so a stale "unverified" banner clears.
      if (signedIn) void qc.invalidateQueries({ queryKey: qk.session });
    },
  });
  const submitted = useRef(false);
  const { mutate } = verify;
  useEffect(() => {
    if (urlToken) void navigate({ to: '/verify-email', search: {}, replace: true });
  }, [urlToken, navigate]);
  useEffect(() => {
    // StrictMode runs effects twice; the token is single use, so submit it exactly once.
    if (!linkToken || submitted.current) return;
    submitted.current = true;
    mutate({ token: cleanToken(linkToken) });
  }, [linkToken, mutate]);

  if (verify.isSuccess)
    return (
      <AuthShell title={t('auth.verify.doneTitle')}>
        <p className="auth-lead">{t('auth.verify.doneBody')}</p>
        <Link className="btn-olive auth-link-btn" to={signedIn ? '/' : '/login'}>
          {signedIn ? t('auth.verify.continue') : t('auth.verify.toLogin')}
        </Link>
      </AuthShell>
    );

  if (verify.isPending && linkToken)
    return (
      <AuthShell title={t('auth.verify.title')}>
        <p className="auth-lead" role="status">
          {t('auth.verify.verifying')}
        </p>
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('auth.verify.title')}
      lead={t('auth.verify.lead')}
      footer={
        <Link to={signedIn ? '/' : '/login'}>
          {signedIn ? t('auth.verify.continue') : t('auth.verify.toLogin')}
        </Link>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanToken(code)) verify.mutate({ token: cleanToken(code) });
        }}
      >
        <label htmlFor="ve-code">{t('auth.verify.code')}</label>
        <input
          id="ve-code"
          className="field"
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder={t('auth.verify.codePlaceholder')}
          value={code}
          aria-invalid={verify.isError || undefined}
          aria-describedby={verify.isError ? 've-error' : undefined}
          onChange={(e) => setCode(e.target.value)}
        />
        {verify.error && (
          <div id="ve-error" className="err-line" role="alert">
            {errorMessage(verify.error, t, 'auth.verify.failed')}
          </div>
        )}
        <button className="btn-olive" disabled={verify.isPending || !cleanToken(code)}>
          {t('auth.verify.submit')}&nbsp;&nbsp;›
        </button>
      </form>
    </AuthShell>
  );
}

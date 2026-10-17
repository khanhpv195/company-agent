import type { ForgotPasswordInput } from '@repo/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../../i18n';
import { api } from '../../lib/api-client';
import { errorMessage } from '../../lib/error-message';
import { AuthShell } from './AuthShell';
import { isEmail } from './auth.logic';

export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const send = useMutation({
    meta: { silentError: true },
    mutationFn: (input: ForgotPasswordInput) => api.post<null>('/auth/forgot-password', input),
  });

  if (send.isSuccess)
    return (
      <AuthShell
        title={t('auth.forgot.sentTitle')}
        footer={<Link to="/login">{t('auth.forgot.back')}</Link>}
      >
        <p className="auth-lead">{t('auth.forgot.sentBody', { email: email.trim() })}</p>
        <Link className="btn-olive auth-link-btn" to="/reset-password">
          {t('auth.forgot.haveCode')}
        </Link>
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('auth.forgot.title')}
      lead={t('auth.forgot.lead')}
      footer={<Link to="/login">{t('auth.forgot.back')}</Link>}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate({ email: email.trim() });
        }}
      >
        <label htmlFor="fp-email">{t('auth.forgot.email')}</label>
        <input
          id="fp-email"
          className="field"
          type="email"
          autoComplete="email"
          required
          placeholder={t('auth.login.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {send.error && (
          <div className="err-line" role="alert">
            {errorMessage(send.error, t, 'auth.forgot.failed')}
          </div>
        )}
        <button className="btn-olive" disabled={send.isPending || !isEmail(email)}>
          {t('auth.forgot.submit')}&nbsp;&nbsp;›
        </button>
      </form>
    </AuthShell>
  );
}

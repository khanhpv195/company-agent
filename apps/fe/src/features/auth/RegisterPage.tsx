import type { AuthResult, RegisterInput } from '@repo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../../i18n';
import { api, ApiError } from '../../lib/api-client';
import { setTokens } from '../../lib/auth-tokens';
import { qk } from '../../lib/query-keys';
import { LegalLink } from './LegalLink';
import { LoginHero } from './LoginHero';
import { isPasswordOk, passwordIssue } from './auth.logic';
import { PRIVACY_URL, TERMS_URL } from './legal';

export function RegisterPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const register = useMutation({
    meta: { silentError: true },
    mutationFn: (input: RegisterInput) => api.post<AuthResult>('/auth/register', input),
    onSuccess: async (result) => {
      // A previous account's cached data must not leak into the new session.
      qc.clear();
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      qc.setQueryData(qk.session, result.session);
      await navigate({ to: result.session.onboarded ? '/' : '/onboarding' });
    },
  });
  const issue = passwordIssue(password, email);
  const canSubmit = acceptTerms && isPasswordOk(password, email.trim());

  return (
    <div className="app">
      <section className="screen login">
        <LoginHero />
        <div className="login-side drag" data-tauri-drag-region>
          <div className="login-box">
            <h1>{t('auth.register.title')}</h1>
            <div className="card">
              <form
                className="card-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  register.mutate({
                    name: name.trim(),
                    email: email.trim(),
                    password,
                    acceptTerms,
                    ...(workspaceName.trim() ? { workspaceName: workspaceName.trim() } : {}),
                  });
                }}
              >
                <label htmlFor="reg-name">{t('auth.register.name')}</label>
                <input
                  id="reg-name"
                  className="field"
                  placeholder={t('auth.register.namePlaceholder')}
                  autoComplete="name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor="reg-email">{t('auth.register.email')}</label>
                <input
                  id="reg-email"
                  className="field"
                  type="email"
                  placeholder={t('auth.register.emailPlaceholder')}
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label htmlFor="reg-password">{t('auth.register.password')}</label>
                <input
                  id="reg-password"
                  className="field"
                  type="password"
                  placeholder={t('auth.register.passwordPlaceholder')}
                  autoComplete="new-password"
                  required
                  maxLength={128}
                  value={password}
                  aria-invalid={!!issue || undefined}
                  aria-describedby="reg-password-msg"
                  onChange={(e) => setPassword(e.target.value)}
                />
                {issue ? (
                  <div id="reg-password-msg" className="err-line" role="alert">
                    {t(`auth.password.${issue}`)}
                  </div>
                ) : (
                  <div id="reg-password-msg" className="field-hint" aria-live="polite">
                    {t('auth.password.hint')}
                  </div>
                )}
                <label htmlFor="reg-workspace">{t('auth.register.workspace')}</label>
                <input
                  id="reg-workspace"
                  className="field"
                  placeholder={
                    name.trim()
                      ? t('auth.register.workspaceDefault', { name: name.trim() })
                      : t('auth.register.workspaceFallback')
                  }
                  maxLength={80}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
                <label className="terms" htmlFor="reg-terms">
                  <input
                    id="reg-terms"
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                  />
                  <span>
                    {t('auth.register.termsLead')}{' '}
                    <LegalLink url={TERMS_URL}>{t('auth.register.termsOfService')}</LegalLink>{' '}
                    {t('auth.register.termsAnd')}{' '}
                    <LegalLink url={PRIVACY_URL}>{t('auth.register.privacyPolicy')}</LegalLink>
                  </span>
                </label>
                {register.error && (
                  <div id="reg-error" className="err-line" role="alert">
                    {register.error instanceof ApiError
                      ? register.error.message
                      : t('auth.register.failed')}
                  </div>
                )}
                <button className="btn-olive" disabled={register.isPending || !canSubmit}>
                  {t('auth.register.submit')}&nbsp;&nbsp;›
                </button>
              </form>
              <div className="card-foot">
                {t('auth.register.haveAccount')} <Link to="/login">{t('auth.register.logIn')}</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

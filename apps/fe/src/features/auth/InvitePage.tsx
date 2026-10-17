import type { AcceptInviteInput, AuthResult, InvitePreview } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { formatRelativeSeconds, useT } from '../../i18n';
import { api, ApiError, toSearchParams } from '../../lib/api-client';
import { setTokens } from '../../lib/auth-tokens';
import { errorMessage } from '../../lib/error-message';
import { qk } from '../../lib/query-keys';
import { useNow } from '../../lib/use-now';
import { ROLE_NAME } from '../workspace/workspace.api';
import { AuthShell } from './AuthShell';
import { LegalLink } from './LegalLink';
import { cleanToken, isPasswordOk, passwordIssue } from './auth.logic';
import { PRIVACY_URL, TERMS_URL } from './legal';

const route = getRouteApi('/invite');

export function InvitePage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const { token: urlToken } = route.useSearch();
  // Keep the link token in state, then drop it from the URL so it does not linger in history.
  const [linkToken] = useState(urlToken);
  const [code, setCode] = useState('');
  const [pasted, setPasted] = useState<string | null>(null);
  useEffect(() => {
    if (urlToken) void navigate({ to: '/invite', search: {}, replace: true });
  }, [urlToken, navigate]);
  const token = pasted ?? linkToken ?? '';

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => api.get<InvitePreview>(`/invites/preview${toSearchParams({ token })}`),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const accept = useMutation({
    meta: { silentError: true },
    mutationFn: (input: AcceptInviteInput) => api.post<AuthResult>('/invites/accept', input),
    onSuccess: async (result) => {
      // A previous account's cached data must not leak into the new session.
      qc.clear();
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      qc.setQueryData(qk.session, result.session);
      await navigate({ to: result.session.onboarded ? '/' : '/onboarding' });
    },
  });

  const footer = (
    <>
      {t('auth.invite.haveAccount')} <Link to="/login">{t('auth.register.logIn')}</Link>
    </>
  );

  if (token && preview.isPending)
    return (
      <AuthShell title={t('auth.invite.title')} footer={footer}>
        <p className="auth-lead" aria-live="polite">
          {t('auth.invite.loading')}
        </p>
      </AuthShell>
    );

  if (!preview.data) {
    return (
      <AuthShell title={t('auth.invite.title')} lead={t('auth.invite.codeLead')} footer={footer}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = cleanToken(code);
            if (clean) setPasted(clean);
          }}
        >
          <label htmlFor="inv-code">{t('auth.invite.code')}</label>
          <input
            id="inv-code"
            className="field"
            spellCheck={false}
            autoComplete="one-time-code"
            placeholder={t('auth.invite.codePlaceholder')}
            value={code}
            aria-invalid={preview.isError || undefined}
            aria-describedby={preview.isError ? 'inv-error' : undefined}
            onChange={(e) => setCode(e.target.value)}
          />
          {preview.isError && (
            <div id="inv-error" className="err-line" role="alert">
              {errorMessage(preview.error, t, 'auth.invite.invalid')}
            </div>
          )}
          <button className="btn-olive" disabled={cleanToken(code).length === 0}>
            {t('auth.invite.continue')}&nbsp;&nbsp;›
          </button>
        </form>
      </AuthShell>
    );
  }

  const inv = preview.data;
  const issue = passwordIssue(password, inv.email);
  const ready = name.trim().length > 0 && isPasswordOk(password, inv.email) && acceptTerms;

  return (
    <AuthShell title={t('auth.invite.title')} footer={footer}>
      <div className="invite-card">
        <div className="invite-ws">{inv.workspaceName}</div>
        <dl>
          <dt>{t('auth.invite.email')}</dt>
          <dd>{inv.email}</dd>
          <dt>{t('auth.invite.role')}</dt>
          <dd>{ROLE_NAME[inv.role]}</dd>
          {inv.invitedByName && (
            <>
              <dt>{t('auth.invite.invitedBy')}</dt>
              <dd>{inv.invitedByName}</dd>
            </>
          )}
          <dt>{t('auth.invite.expires')}</dt>
          <dd>{formatRelativeSeconds((now - Date.parse(inv.expiresAt)) / 1000)}</dd>
        </dl>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) accept.mutate({ token, name: name.trim(), password, acceptTerms: true });
        }}
      >
        <label htmlFor="inv-name">{t('auth.register.name')}</label>
        <input
          id="inv-name"
          className="field"
          placeholder={t('auth.register.namePlaceholder')}
          autoComplete="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="inv-password">{t('auth.register.password')}</label>
        <input
          id="inv-password"
          className="field"
          type="password"
          placeholder={t('auth.register.passwordPlaceholder')}
          autoComplete="new-password"
          required
          maxLength={128}
          value={password}
          aria-invalid={!!issue || undefined}
          aria-describedby="inv-password-msg"
          onChange={(e) => setPassword(e.target.value)}
        />
        {issue ? (
          <div id="inv-password-msg" className="err-line" role="alert">
            {t(`auth.password.${issue}`)}
          </div>
        ) : (
          <div id="inv-password-msg" className="field-hint" aria-live="polite">
            {t('auth.password.hint')}
          </div>
        )}
        <label className="terms" htmlFor="inv-terms">
          <input
            id="inv-terms"
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
        {accept.error && (
          <div className="err-line" role="alert">
            {accept.error instanceof ApiError && accept.error.status === 409
              ? t('auth.invite.emailTaken')
              : errorMessage(accept.error, t, 'auth.invite.failed')}
          </div>
        )}
        <button className="btn-olive" disabled={accept.isPending || !ready}>
          {t('auth.invite.submit')}&nbsp;&nbsp;›
        </button>
      </form>
    </AuthShell>
  );
}

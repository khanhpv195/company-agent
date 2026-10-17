import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { create } from 'zustand';
import { useT } from '../i18n';
import { api } from '../lib/api-client';
import { errorMessage } from '../lib/error-message';
import { useSession } from '../features/workspace/workspace.api';
import { useUi } from '../stores/ui';

/**
 * Dismissed user ids for this app session only (memory, not storage), so the banner returns on
 * restart. Keyed by user id, so dismissing it for one account does not hide it for another.
 */
const useDismissed = create<{ ids: string[]; dismiss: (userId: string) => void }>()((set) => ({
  ids: [],
  dismiss: (userId) => set((s) => (s.ids.includes(userId) ? s : { ids: [...s.ids, userId] })),
}));

/** Strip above the app while the signed-in email is unverified. */
export function VerifyEmailBanner() {
  const t = useT();
  const user = useSession().data?.user;
  const dismissed = useDismissed((s) => (user ? s.ids.includes(user.id) : false));
  const dismiss = useDismissed((s) => s.dismiss);
  const showToast = useUi((s) => s.showToast);
  const resend = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.post<null>('/me/verify-email/resend'),
    onSuccess: () => showToast({ text: t('auth.banner.sent'), agentId: null, taskId: null }),
    onError: (e) =>
      showToast({
        text: errorMessage(e, t, 'auth.banner.failed'),
        agentId: null,
        taskId: null,
        tone: 'error',
      }),
  });
  if (!user || user.emailVerified || dismissed) return null;
  return (
    <div className="verify-banner" role="status">
      <span className="verify-text">{t('auth.banner.text', { email: user.email })}</span>
      <button className="verify-act" disabled={resend.isPending} onClick={() => resend.mutate()}>
        {resend.isPending ? t('auth.banner.sending') : t('auth.banner.resend')}
      </button>
      <Link className="verify-act" to="/verify-email">
        {t('auth.banner.enterCode')}
      </Link>
      <button
        className="verify-close"
        aria-label={t('auth.banner.dismiss')}
        title={t('auth.banner.dismiss')}
        onClick={() => user && dismiss(user.id)}
      >
        ×
      </button>
    </div>
  );
}

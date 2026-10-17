import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL, MOCK } from '../lib/api-client';
import { markReachable, startReachabilityProbe, useConnectivity } from '../lib/connectivity';
import { useT } from '../i18n';

/** Thin bar above the app while the device is offline or the API cannot be reached. */
export function ConnectivityBanner() {
  const t = useT();
  const qc = useQueryClient();
  const offline = useConnectivity((s) => s.browserOffline);
  const unreachable = useConnectivity((s) => s.apiUnreachable);
  const down = offline || unreachable;
  // Probe /health with backoff while down, so the banner clears itself even with no active queries.
  useEffect(() => {
    if (!down || MOCK) return;
    return startReachabilityProbe({
      url: `${API_URL}/health`,
      onRecovered: () => {
        markReachable();
        void qc.refetchQueries({ type: 'active' });
      },
    });
  }, [down, qc]);
  useEffect(() => {
    const onOnline = () => void qc.refetchQueries({ type: 'active' });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [qc]);
  if (!down) return null;
  return (
    <div className="conn-banner" role="status" aria-live="polite">
      <span>{offline ? t('errors.offlineNetwork') : t('errors.offline')}</span>
      <button onClick={() => void qc.refetchQueries({ type: 'active' })}>
        {t('common.retry')}
      </button>
    </div>
  );
}

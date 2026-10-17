import type { CliStatus, Computer, Session } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../../i18n';
import { api } from '../../lib/api-client';
import { ago } from '../../lib/format';
import { qk } from '../../lib/query-keys';
import { useNow } from '../../lib/use-now';
import { PairingPanel } from '../computers/PairingPanel';
import { useComputerArrivals } from '../computers/computers.api';

export function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const now = useNow();
  const status = useQuery({
    queryKey: ['onboarding', 'cli-status'],
    queryFn: () => api.get<CliStatus>('/onboarding/cli-status'),
    refetchInterval: (q) => (q.state.data?.connected ? false : 1000),
  });
  // Simulator path: the cli-status poll names the simulated computer once it is online.
  const { computers: list, arrived, rebase } = useComputerArrivals();
  const pc = list.find((c) => c.id === status.data?.computerId);
  const shown: Computer | undefined = pc ?? arrived;
  const finish = useMutation({
    mutationFn: () => api.post<Session>('/onboarding/complete'),
    onSuccess: async (s) => {
      qc.setQueryData(qk.session, s);
      await navigate({ to: '/' });
    },
  });

  return (
    <div className="app">
      <section className="screen onboard drag" data-tauri-drag-region>
        <div className="ob">
          <div className="steps" aria-label={t('auth.onboarding.steps', { n: 3, total: 4 })}>
            <span className="done" />
            <span className="done" />
            <span className="done" />
            <span />
          </div>
          <h2>{t('auth.onboarding.title')}</h2>
          <p className="lead">{t('auth.onboarding.lead')}</p>
          <PairingPanel arrived={arrived} onAgain={rebase} />
          {!shown && (
            <ol>
              <li>{t('auth.onboarding.step1')}</li>
              <li>{t('auth.onboarding.step2')}</li>
            </ol>
          )}
          <div className="status" aria-live="polite">
            {shown ? (
              <>
                <span className="dot on" />
                <div>
                  <b>{shown.name}</b>
                  {t('auth.onboarding.connectedSuffix')}
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {t('auth.onboarding.heartbeat', {
                      os: shown.os,
                      version: shown.cliVersion,
                      ago: ago(shown.lastHeartbeatAt, now),
                    })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="spinner" />
                <span>{t('auth.onboarding.waiting')}</span>
              </>
            )}
          </div>
          {!shown && (
            <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
              {t('auth.onboarding.simulatorHint')}
            </p>
          )}
          <button
            className="btn-olive"
            disabled={!shown || finish.isPending}
            onClick={() => finish.mutate()}
          >
            {t('auth.onboarding.createAgent')}&nbsp;&nbsp;›
          </button>
          <button className="skip" onClick={() => finish.mutate()}>
            {t('auth.onboarding.skip')}
          </button>
        </div>
      </section>
    </div>
  );
}

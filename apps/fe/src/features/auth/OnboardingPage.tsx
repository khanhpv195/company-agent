import type { CliStatus, Computer, Session } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../../lib/api-client';
import { ago } from '../../lib/format';
import { qk } from '../../lib/query-keys';
import { useNow } from '../../lib/use-now';
import { PairingPanel } from '../computers/PairingPanel';
import { useComputerArrivals } from '../computers/computers.api';

export function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
          <div className="steps" aria-label="Bước 3/4">
            <span className="done" />
            <span className="done" />
            <span className="done" />
            <span />
          </div>
          <h2>Connect this computer</h2>
          <p className="lead">
            Agent chạy Claude Code ngay trên máy của bạn. Tạo mã kết nối và chạy lệnh trên máy đó để
            máy nhận việc khi có người @mention agent trong room.
          </p>
          <PairingPanel arrived={arrived} onAgain={rebase} />
          <ol>
            <li>Mở Terminal trên máy muốn kết nối và chạy lệnh trên.</li>
            <li>Giữ CLI chạy nền, máy sẽ hiện online bên dưới.</li>
          </ol>
          <div className="status" aria-live="polite">
            {shown ? (
              <>
                <span className="dot on" />
                <div>
                  <b>{shown.name}</b> đã kết nối
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {shown.os} · CLI {shown.cliVersion} · heartbeat{' '}
                    {ago(shown.lastHeartbeatAt, now)}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="spinner" />
                <span>Đang chờ máy kết nối…</span>
              </>
            )}
          </div>
          {!shown && (
            <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
              Đang dùng máy mô phỏng (demo)? Máy đó sẽ tự kết nối sau vài giây.
            </p>
          )}
          <button
            className="btn-olive"
            disabled={!shown || finish.isPending}
            onClick={() => finish.mutate()}
          >
            Tạo agent đầu tiên&nbsp;&nbsp;›
          </button>
          <button className="skip" onClick={() => finish.mutate()}>
            Bỏ qua, làm sau
          </button>
        </div>
      </section>
    </div>
  );
}

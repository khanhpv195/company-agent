import type { CliStatus, Session } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../../lib/api-client';
import { ago } from '../../lib/format';
import { qk } from '../../lib/query-keys';
import { useNow } from '../../lib/use-now';
import { CopyCommand } from '../computers/CopyCommand';
import { computersQuery } from '../workspace/workspace.api';

export function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const session = qc.getQueryData<Session>(qk.session);
  const status = useQuery({
    queryKey: ['onboarding', 'cli-status'],
    queryFn: () => api.get<CliStatus>('/onboarding/cli-status'),
    refetchInterval: (q) => (q.state.data?.connected ? false : 1000),
  });
  const connected = !!status.data?.connected;
  const computers = useQuery({ ...computersQuery, enabled: connected, refetchInterval: 3000 }).data;
  const pc = computers?.find((c) => c.id === status.data?.computerId);
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
            Agent chạy Claude Code ngay trên máy của bạn. Cài CLI để máy này nhận việc khi có người
            @mention agent trong room.
          </p>
          <CopyCommand
            command={`npx @agent/cli connect --workspace ${session?.workspace.slug ?? 'workspace'}`}
          />
          <ol>
            <li>Mở Terminal và chạy lệnh trên.</li>
            <li>Đăng nhập trong trình duyệt khi CLI hỏi.</li>
            <li>
              Giữ CLI chạy nền, máy sẽ hiện <b>online</b> bên dưới.
            </li>
          </ol>
          <div className="status" aria-live="polite">
            {connected && pc ? (
              <>
                <span className="dot on" />
                <div>
                  <b>{pc.name}</b> đã kết nối
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {pc.os} · CLI {pc.cliVersion} · heartbeat {ago(pc.lastHeartbeatAt, now)}
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
          <button
            className="btn-olive"
            disabled={!connected || finish.isPending}
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

import type { Connection, ReplyMode, Room } from '@repo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ChannelLogo } from '../../components/ChannelLogo';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useUi } from '../../stores/ui';
import { inboxThreadId } from '../chat/chat.logic';
import { usePeople } from '../workspace/workspace.api';
import { useConnectionActions, useConnections } from './connections.api';

/** Mock OAuth → choose account → route into a room with an agent. */
export function ConnectWizard() {
  const id = useUi((s) => s.wizard);
  const setWizard = useUi((s) => s.setWizard);
  const c = useConnections().find((x) => x.id === id);
  if (!c) return null;
  return <Wizard key={c.id} c={c} onClose={() => setWizard(null)} />;
}

const STEP_NAMES = ['Ủy quyền', 'Chọn tài khoản', 'Định tuyến'];

function Wizard({ c, onClose }: { c: Connection; onClose: () => void }) {
  const people = usePeople();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const actions = useConnectionActions();
  const on = c.status === 'on';
  const agents = people.agents.filter((a) => a.status !== 'offline');
  const [step, setStep] = useState(on ? 3 : 1);
  const [account, setAccount] = useState(
    Math.max(
      0,
      c.accounts.findIndex((a) => a.name === c.account),
    ),
  );
  const [roomName, setRoomName] = useState(c.roomName);
  const [agentId, setAgentId] = useState(c.agentId ?? agents[0]?.id ?? '');
  const [mode, setMode] = useState<ReplyMode>(c.mode);

  const authorize = () => actions.authorize.mutate(c.id, { onSuccess: () => setStep(2) });
  const finish = () =>
    actions.connect.mutate(
      { id: c.id, account: c.accounts[account].name, roomName, agentId, mode },
      {
        onSuccess: () => {
          onClose();
          if (on) return;
          // The inbox thread id is server-generated: look it up in a fresh room list.
          void qc
            .fetchQuery({
              queryKey: qk.rooms,
              queryFn: () => api.get<Room[]>('/rooms'),
              staleTime: 0,
            })
            .then((rooms) => {
              const chatId = inboxThreadId(rooms, c.id);
              if (chatId) void navigate({ to: '/chat/$chatId', params: { chatId } });
            })
            .catch(() => undefined);
        },
      },
    );

  return (
    <Modal onClose={onClose} label={`Kết nối ${c.name}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ChannelLogo id={c.id} size={38} />
        <div>
          <h3 style={{ margin: 0 }}>
            {on ? 'Cấu hình' : 'Kết nối'} {c.name}
          </h3>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            Bước {step}/3 · {STEP_NAMES[step - 1]}
          </div>
        </div>
        <button
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
          aria-label="Đóng"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="wz-steps">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= step ? 'done' : ''} />
        ))}
      </div>

      {step === 1 && (
        <>
          <p>
            Đăng nhập {c.shortName} trong trình duyệt để cấp quyền. Agent chỉ dùng các quyền dưới
            đây, bạn thu hồi được bất cứ lúc nào.
          </p>
          {c.permissions.map((p) => (
            <div key={p} className="perm">
              <span style={{ color: 'var(--ok)', display: 'flex' }}>
                <Icon name="shield" size={16} />
              </span>
              {p}
            </div>
          ))}
          <div className="wz-foot">
            <button className="btn" onClick={onClose}>
              Huỷ
            </button>
            <button
              className="btn primary"
              onClick={authorize}
              disabled={actions.authorize.isPending}
            >
              {actions.authorize.isPending ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      width: 14,
                      height: 14,
                      borderColor: 'rgba(255,255,255,.35)',
                      borderTopColor: '#fff',
                    }}
                  />{' '}
                  Đang chờ trình duyệt…
                </>
              ) : (
                `Đăng nhập ${c.shortName}`
              )}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p>Chọn {c.accountLabel} sẽ nối vào workspace.</p>
          {c.accounts.map((a, i) => (
            <div
              key={a.name}
              className={`opt-row ${i === account ? 'sel' : ''}`}
              role="radio"
              aria-checked={i === account}
              tabIndex={0}
              onClick={() => setAccount(i)}
            >
              <ChannelLogo id={c.id} size={30} />
              <div>
                <b>{a.name}</b>
                <div className="sub">{a.detail}</div>
              </div>
            </div>
          ))}
          <div className="wz-foot">
            <button className="btn" onClick={() => setStep(1)}>
              Quay lại
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              Tiếp tục
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <label htmlFor="wz-room">Room nhận tin</label>
          <input
            id="wz-room"
            className="field"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
          />
          <label htmlFor="wz-agent" style={{ marginTop: 14 }}>
            Agent phụ trách
          </label>
          <select
            id="wz-agent"
            className="field"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label style={{ marginTop: 14 }}>Cách trả lời</label>
          <div
            className={`opt-row ${mode === 'draft' ? 'sel' : ''}`}
            role="radio"
            aria-checked={mode === 'draft'}
            tabIndex={0}
            onClick={() => setMode('draft')}
          >
            <span style={{ display: 'flex', color: 'var(--olive)' }}>
              <Icon name="shield" />
            </span>
            <div>
              <b>Soạn nháp, bạn duyệt rồi gửi</b>
              <div className="sub">An toàn khi mới bắt đầu. Khuyên dùng.</div>
            </div>
          </div>
          <div
            className={`opt-row ${mode === 'auto' ? 'sel' : ''}`}
            role="radio"
            aria-checked={mode === 'auto'}
            tabIndex={0}
            onClick={() => setMode('auto')}
          >
            <span style={{ display: 'flex', color: 'var(--claude)' }}>
              <Icon name="zap" />
            </span>
            <div>
              <b>Agent tự trả lời</b>
              <div className="sub">Gửi ngay, bạn xem lại trong room.</div>
            </div>
          </div>
          <div className="wz-foot">
            {on ? (
              <button className="btn" onClick={onClose}>
                Huỷ
              </button>
            ) : (
              <button className="btn" onClick={() => setStep(2)}>
                Quay lại
              </button>
            )}
            <button
              className="btn primary"
              onClick={finish}
              disabled={actions.connect.isPending || !agentId}
            >
              {on ? 'Lưu' : 'Hoàn tất'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

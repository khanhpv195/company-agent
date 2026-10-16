import type { Connection } from '@repo/shared';
import { Link } from '@tanstack/react-router';
import { AgentArt } from '../../components/Avatar';
import { ChannelLogo, LetterLogo } from '../../components/ChannelLogo';
import { Icon } from '../../components/Icon';
import { useUi } from '../../stores/ui';
import { usePeople, useSession } from '../workspace/workspace.api';
import { useConnectionActions, useConnections } from './connections.api';

const SOON: [string, string, string, string, string][] = [
  ['Telegram', 'Bot nhận tin trong group và chat riêng', '#29a9eb', '#fff', 'T'],
  ['Slack', 'Đồng bộ channel giữa Slack và room', '#4a154b', '#fff', 'S'],
  ['Google Calendar', 'Agent xếp lịch và nhắc họp', '#1a73e8', '#fff', '31'],
  ['Notion', 'Đọc và cập nhật trang, database', '#191919', '#fff', 'N'],
  ['Instagram', 'Trả lời DM và comment', '#d62976', '#fff', 'Ig'],
  ['Webhook', 'Đẩy sự kiện bất kỳ vào room', '#efede6', '#5c5c58', '{}'],
];

export function ConnectionsPage() {
  const connections = useConnections();
  const session = useSession().data;
  return (
    <main className="main">
      <div className="dash">
        <div className="dash-in">
          <div className="page-head drag" data-tauri-drag-region>
            <div>
              <div className="dash-date">Workspace · {session?.workspace.slug}</div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  letterSpacing: '-0.035em',
                  margin: '0 0 8px',
                }}
              >
                Connections
              </h1>
              <p
                style={{
                  color: 'var(--soft)',
                  margin: '0 0 22px',
                  maxWidth: 640,
                  lineHeight: 1.55,
                }}
              >
                Nối kênh bên ngoài vào workspace. Tin nhắn mới đổ vào một room riêng, agent đọc và
                soạn câu trả lời, rồi gửi ngược lại đúng kênh.
              </p>
            </div>
          </div>
          <div className="flow">
            <div className="step">
              <span style={{ display: 'flex', gap: 4 }}>
                {['zalo', 'facebook', 'gmail'].map((k) => (
                  <ChannelLogo key={k} id={k} size={20} />
                ))}
              </span>
              Khách nhắn tin
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="inbox" size={16} />
              Vào room <code>#…-inbox</code>
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <span className="av" style={{ width: 20, height: 20 }}>
                <AgentArt variant={0} />
              </span>
              Agent soạn trả lời
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="check" size={16} />
              Bạn duyệt <span style={{ color: 'var(--muted)' }}>(tuỳ chọn)</span>
            </div>
            <span className="arr">
              <Icon name="arrow" size={15} />
            </span>
            <div className="step">
              <Icon name="send" size={15} />
              Gửi lại đúng kênh
            </div>
          </div>
          <div className="h-sec">Kênh tin nhắn</div>
          <div className="conn-grid">
            {connections.map((c) => (
              <ConnectionCard key={c.id} c={c} />
            ))}
          </div>
          <div className="h-sec">Sắp có</div>
          <div className="conn-grid soon">
            {SOON.map(([name, desc, bg, fg, letter]) => (
              <div key={name} className="conn">
                <div className="top">
                  <LetterLogo bg={bg} fg={fg} text={letter} size={44} />
                  <div>
                    <h4>{name}</h4>
                    <div className="s">{desc}</div>
                  </div>
                  <span className="pill">Sắp có</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  const setWizard = useUi((s) => s.setWizard);
  const { disconnect } = useConnectionActions();
  const people = usePeople();
  if (c.status !== 'on')
    return (
      <div className="conn">
        <div className="top">
          <ChannelLogo id={c.id} size={44} />
          <div>
            <h4>{c.name}</h4>
            <div className="s">{c.accountLabel}</div>
          </div>
          <span className="pill">Chưa kết nối</span>
        </div>
        <p>{c.description}</p>
        <div className="chips">
          {c.capabilities.map((x) => (
            <span key={x} className="chip">
              {x}
            </span>
          ))}
        </div>
        <div className="foot">
          <button className="btn primary" onClick={() => setWizard(c.id)}>
            <Icon name="plug" size={15} /> Kết nối {c.shortName}
          </button>
        </div>
      </div>
    );
  return (
    <div className="conn on">
      <div className="top">
        <ChannelLogo id={c.id} size={44} />
        <div>
          <h4>{c.name}</h4>
          <div className="s">{c.account}</div>
        </div>
        <span className="pill ok">
          <span className="dot on" style={{ boxShadow: 'none' }} />
          Đang hoạt động
        </span>
      </div>
      <dl className="kv">
        <dt>Room nhận tin</dt>
        <dd>
          <Link className="link" to="/chat/$chatId" params={{ chatId: `t-${c.id}` }}>
            #{c.roomName}
          </Link>
        </dd>
        <dt>Agent phụ trách</dt>
        <dd>{people.name(c.agentId)}</dd>
        <dt>Cách trả lời</dt>
        <dd>{c.mode === 'draft' ? 'Soạn nháp, bạn duyệt rồi gửi' : 'Agent tự trả lời'}</dd>
      </dl>
      <div className="foot">
        <Link className="btn" to="/chat/$chatId" params={{ chatId: `t-${c.id}` }}>
          <Icon name="inbox" size={15} /> Mở room
        </Link>
        <button className="btn" onClick={() => setWizard(c.id)}>
          Cấu hình
        </button>
        <button
          className="btn"
          style={{ color: 'var(--err)' }}
          onClick={() => disconnect.mutate(c.id)}
        >
          Ngắt kết nối
        </button>
      </div>
    </div>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api-client';
import { ROLE_NAME, usePeople, useSession } from '../workspace/workspace.api';

const route = getRouteApi('/_app/settings/$section');
const SECTIONS = [
  ['profile', 'Profile'],
  ['members', 'Members'],
  ['notifications', 'Notifications'],
  ['billing', 'Billing'],
  ['desktop', 'Desktop'],
] as const;

export function SettingsPage() {
  const { section } = route.useParams();
  const title = SECTIONS.find(([id]) => id === section)?.[1] ?? 'Settings';
  return (
    <>
      <aside className="panel" aria-label="Settings">
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>Settings</h3>
        </div>
        <div className="panel-body">
          {SECTIONS.map(([id, name]) => (
            <Link
              key={id}
              to="/settings/$section"
              params={{ section: id }}
              className={`item ${section === id ? 'on' : ''}`}
              style={{ alignItems: 'center' }}
            >
              <div className="meta">
                <span className="name" style={{ fontWeight: 500 }}>
                  {name}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <h2>{title}</h2>
          <p className="lead"> </p>
          <Section id={section} />
        </div>
      </main>
    </>
  );
}

function Section({ id }: { id: string }) {
  const session = useSession().data;
  const people = usePeople();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    await navigate({ to: '/login' });
  };

  if (id === 'profile')
    return (
      <div className="box" style={{ maxWidth: 520 }}>
        <label htmlFor="pf-name">Tên hiển thị</label>
        <input id="pf-name" className="field" defaultValue={session?.user.name} />
        <label htmlFor="pf-email" style={{ marginTop: 14 }}>
          Email
        </label>
        <input
          id="pf-email"
          className="field"
          value={session?.user.email ?? ''}
          disabled
          readOnly
        />
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => void logout()}>
            <Icon name="logout" size={16} /> Đăng xuất
          </button>
        </div>
      </div>
    );
  if (id === 'members')
    return (
      <>
        <table>
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name} <span style={{ color: 'var(--muted)' }}>· {m.email}</span>
                </td>
                <td>{ROLE_NAME[m.role]}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn" disabled={m.role === 'owner'}>
                    Đổi role
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary">
            <Icon name="plus" size={16} /> Mời thành viên
          </button>
        </div>
      </>
    );
  if (id === 'notifications')
    return (
      <div className="box" style={{ maxWidth: 520 }}>
        {[
          'Thông báo khi agent trả lời xong',
          'Thông báo khi được @mention',
          'Badge số chưa đọc trên Dock',
        ].map((t) => (
          <label key={t} style={{ display: 'flex', gap: 10, fontWeight: 400, margin: '10px 0' }}>
            <input type="checkbox" defaultChecked /> {t}
          </label>
        ))}
      </div>
    );
  if (id === 'billing')
    return (
      <div className="grid2">
        {[
          ['free', 'Free', '$0', '1 computer · 1 agent'],
          ['pro', 'Pro', '$20/tháng', '3 computers · agent không giới hạn'],
          ['team', 'Team', '$40/người', 'SSO · audit log'],
        ].map(([plan, name, price, desc]) => {
          const current = session?.workspace.plan === plan;
          return (
            <div
              key={plan}
              className="box"
              style={current ? { borderColor: 'var(--olive)' } : undefined}
            >
              <h4>
                {name}
                {current ? ' · Hiện tại' : ''}
              </h4>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{price}</div>
              <p style={{ color: 'var(--soft)' }}>{desc}</p>
              <button
                className={`btn ${plan === 'pro' && !current ? 'primary' : ''}`}
                disabled={current}
              >
                {current ? 'Đang dùng' : 'Nâng cấp'}
              </button>
            </div>
          );
        })}
      </div>
    );
  if (id === 'desktop')
    return (
      <div className="box" style={{ maxWidth: 520 }}>
        <dl className="kv">
          <dt>Phiên bản</dt>
          <dd>0.1.0 (mới nhất)</dd>
          <dt>Auto-update</dt>
          <dd>Bật</dd>
          <dt>URL scheme</dt>
          <dd>
            <code>agent://</code>
          </dd>
        </dl>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="btn">Kiểm tra cập nhật</button>
          <button className="btn">Gửi log cho support</button>
        </div>
      </div>
    );
  return <p>Không có mục này.</p>;
}

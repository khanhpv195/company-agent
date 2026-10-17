import type { Computer } from '@repo/shared';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Dot } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ago } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useUi } from '../../stores/ui';
import { useCanManage } from '../people/people.api';
import { usePeople } from '../workspace/workspace.api';
import { RevokeComputerModal } from './RevokeComputerModal';
import { isSimulated } from './computers.logic';

const route = getRouteApi('/_app/computers');
const presence = (c: Computer) => (c.status === 'online' ? 'on' : 'off');

export function ComputersPage() {
  const { focus } = route.useSearch();
  const people = usePeople();
  const now = useNow();
  const setOpen = useUi((s) => s.setConnectComputerOpen);
  const openNewAgent = useUi((s) => s.openNewAgent);
  const canManage = useCanManage();
  const selected = focus ?? people.computers[0]?.id;
  const [revoking, setRevoking] = useState<Computer | null>(null);
  return (
    <>
      <aside className="panel" aria-label="Computers">
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>Computers</h3>
          <button className="icon-btn" title="Connect a computer" onClick={() => setOpen(true)}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="panel-body">
          {people.computers.map((c) => (
            <Link
              key={c.id}
              to="/computers"
              search={{ focus: c.id }}
              className={`item ${selected === c.id ? 'on' : ''}`}
            >
              <div className="av" style={{ background: '#f0efe9', color: '#555' }}>
                <Icon name="monitor" size={20} />
              </div>
              <div className="meta">
                <div className="row">
                  <span className="name">{c.name}</span>
                  {isSimulated(c) && <span className="badge">Mô phỏng</span>}
                  {c.revokedAt && <span className="badge">Đã gỡ</span>}
                  <Dot state={presence(c)} style={{ marginTop: 6 }} />
                </div>
                <div className="prev">{c.os}</div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <div className="page-head">
            <div>
              <h2>Computers</h2>
              <p className="lead">
                Máy đã kết nối vào workspace. Agent chạy Claude Code trên các máy này.
              </p>
            </div>
            <button className="btn primary" onClick={() => setOpen(true)}>
              <Icon name="plus" size={16} /> Connect a computer
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Trạng thái</th>
                <th>Heartbeat</th>
                <th>Agents</th>
                <th>CLI</th>
                <th>Keep awake</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {people.computers.map((c) => (
                <tr key={c.id} style={c.id === selected ? { background: '#fafaf7' } : undefined}>
                  <td>
                    <b>{c.name}</b>
                    {isSimulated(c) && (
                      <span className="pill" style={{ marginLeft: 8 }}>
                        Mô phỏng
                      </span>
                    )}
                    {c.revokedAt && (
                      <span className="pill" style={{ marginLeft: 8 }}>
                        Đã gỡ
                      </span>
                    )}
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{c.os}</div>
                  </td>
                  <td>
                    <Dot state={presence(c)} /> {c.status}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{ago(c.lastHeartbeatAt, now)}</td>
                  <td>
                    {people.agents
                      .filter((a) => a.computerId === c.id)
                      .map((a) => a.name)
                      .join(', ')}
                  </td>
                  <td>
                    <code>{c.cliVersion}</code>
                  </td>
                  <td>{c.keepAwake ? 'On' : 'Off'}</td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn sm"
                        title={`Thêm agent trên ${c.name}`}
                        onClick={() => openNewAgent(c.id)}
                      >
                        <Icon name="plus" size={14} /> Thêm agent
                      </button>
                      {!isSimulated(c) && !c.revokedAt && (
                        <button
                          className="btn sm"
                          style={{ marginLeft: 6 }}
                          title={`Gỡ ${c.name}`}
                          onClick={() => setRevoking(c)}
                        >
                          <Icon name="x" size={14} /> Gỡ máy
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {revoking && <RevokeComputerModal computer={revoking} onClose={() => setRevoking(null)} />}
    </>
  );
}

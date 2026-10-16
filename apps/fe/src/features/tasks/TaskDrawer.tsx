import { queueOf, runningOf, type Task, type TaskPriority, type TaskStatus } from '@repo/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Inline, Markdown } from '../../components/Markdown';
import { Who } from '../../components/Who';
import { dur, hhmm, mmss, ms, rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useUi } from '../../stores/ui';
import { useRooms } from '../chat/chat.api';
import { chatLabel } from '../chat/chat.logic';
import { usePeople } from '../workspace/workspace.api';
import { useTaskActions } from './tasks.api';
import { Elapsed, Label, PriorityIcon, StatusIcon } from './task-ui';
import { COLUMNS, PRIORITIES } from './tasks.logic';

const RUN_COLOR = {
  completed: 'var(--ok)',
  failed: 'var(--err)',
  cancelled: 'var(--muted)',
  expired: 'var(--muted)',
};

export function TaskDrawer({
  task: t,
  tasks,
  onClose,
}: {
  task: Task;
  tasks: Task[];
  onClose: () => void;
}) {
  const people = usePeople();
  const rooms = useRooms();
  const now = useNow();
  const navigate = useNavigate();
  const actions = useTaskActions();
  const setConnectComputerOpen = useUi((s) => s.setConnectComputerOpen);
  const [comment, setComment] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const agent = people.agent(t.assigneeId);
  const run = t.activeRun;
  const room = t.chatId ? chatLabel(rooms, t.chatId) : null;
  const canOpenRoom =
    !!t.chatId &&
    rooms.some(
      (r) => (r.id === t.chatId && r.kind === 'dm') || r.threads.some((th) => th.id === t.chatId),
    );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.step]);

  const openRoom = () => {
    if (t.chatId) void navigate({ to: '/chat/$chatId', params: { chatId: t.chatId } });
  };

  let top = null;
  if (run && agent) {
    const pc = people.computer(run.computerId);
    top = (
      <div className="runbox">
        <div className="runbox-h">
          <span className="mini-spin" />
          <b>Run #{run.n} đang chạy</b>
          <span style={{ color: 'var(--muted)' }}>
            trên {pc?.name} · bước {Math.min(run.step + 1, run.steps.length)}/{run.steps.length}
          </span>
          <span className="sp" />
          <Elapsed since={run.startedAt} />
          <button className="btn sm" onClick={() => actions.stop.mutate(t.id)}>
            <Icon name="stop" size={12} /> Dừng
          </button>
          {canOpenRoom && (
            <button className="btn sm" onClick={openRoom}>
              <Icon name="chat" size={12} /> Mở room
            </button>
          )}
        </div>
        <div className="runlog" ref={logRef} aria-live="polite">
          {run.steps.slice(0, run.step + 1).map((s, i) => (
            <div key={i} className={i < run.step ? 'ok' : 'cur'}>
              <span className="tm">{hhmm(ms(run.startedAt) + i * 5200)}</span>
              {i < run.step ? '✓' : '›'} <span className="tn">{s.tool}</span>
              {s.input}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (t.status === 'doing' && !agent && t.assigneeId) {
    top = (
      <div className="banner hum">
        <Icon name="user" size={16} /> {people.name(t.assigneeId)} tự làm task này, không có run tự
        động.
      </div>
    );
  } else if (t.blockedReason) {
    top = (
      <div className="banner blk">
        <Icon name="lock" size={16} />
        <span>
          Bị chặn: <b>{t.blockedReason}</b>. Agent sẽ tự chạy khi máy online lại.
        </span>
        <span className="sp" />
        <button className="btn sm" onClick={() => setConnectComputerOpen(true)}>
          Hướng dẫn
        </button>
      </div>
    );
  } else if (t.error) {
    top = (
      <div className="banner err">
        <Icon name="alert" size={16} />
        <span>{t.error}</span>
        <span className="sp" />
        <button className="btn sm" onClick={() => actions.retry.mutate(t.id)}>
          <Icon name="refresh" size={12} /> Chạy lại
        </button>
      </div>
    );
  } else if (t.status === 'review') {
    top = (
      <div className="revbox">
        <div className="h">
          <Icon name="shield" size={15} /> {people.name(t.assigneeId)} đã xong, chờ bạn duyệt
        </div>
        <div className="out">
          <Markdown text={t.output ?? 'Không có kết quả.'} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary sm" onClick={() => actions.approve.mutate(t.id)}>
            <Icon name="check" size={12} /> Duyệt
          </button>
          <button
            className="btn sm"
            onClick={() => {
              actions.revise.mutate({ id: t.id, note: comment });
              setComment('');
            }}
            title="Ghi chú trong ô bình luận sẽ được gửi kèm"
          >
            Yêu cầu sửa
          </button>
        </div>
      </div>
    );
  } else if (t.status === 'todo' && agent) {
    const queue = queueOf(tasks, agent.id);
    const busy = runningOf(tasks, agent.id);
    top = (
      <div className="banner blk">
        <Icon name="clock" size={16} />
        <span>
          Vị trí{' '}
          <b>
            {queue.findIndex((x) => x.id === t.id) + 1}/{queue.length}
          </b>{' '}
          trong hàng đợi của {agent.name}
          {busy && (
            <>
              , agent đang làm <b>{busy.id}</b>
            </>
          )}
          .
        </span>
        <span className="sp" />
        <button className="btn sm" onClick={() => actions.runNow.mutate(t.id)}>
          <Icon name="play" size={12} /> Chạy ngay
        </button>
      </div>
    );
  } else if (!t.assigneeId) {
    top = (
      <div className="banner blk">
        <Icon name="user" size={16} />
        <span>
          Chưa giao cho ai. Chọn agent ở mục <b>Người làm</b> để đưa vào hàng đợi.
        </span>
      </div>
    );
  }

  const acts = [...t.activity].sort((a, b) => ms(a.at) - ms(b.at));
  const submitComment = () => {
    const text = comment.trim();
    if (!text) return;
    actions.comment.mutate({ id: t.id, markdown: text });
    setComment('');
  };

  return (
    <div className="drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label={`Task ${t.id}`}>
        <div className="dr-top">
          <StatusIcon status={t.status} />
          <span>{t.id}</span>
          {room && <span>· {room}</span>}
          <span className="sp" />
          <button
            className="icon-btn"
            title="Sao chép mã task"
            onClick={() => void navigator.clipboard?.writeText(t.id).catch(() => {})}
          >
            <Icon name="copy" size={15} />
          </button>
          <button className="icon-btn" title="Đóng (Esc)" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="dr-body">
          <h2>{t.title}</h2>
          <dl className="props">
            <dt>Trạng thái</dt>
            <dd>
              <StatusIcon status={t.status} />
              <select
                aria-label="Trạng thái"
                value={t.status}
                onChange={(e) =>
                  actions.move.mutate({
                    id: t.id,
                    status: e.target.value as TaskStatus,
                    beforeId: null,
                  })
                }
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </dd>
            <dt>Người làm</dt>
            <dd>
              <Who id={t.assigneeId} />
              <select
                aria-label="Người làm"
                value={t.assigneeId ?? ''}
                onChange={(e) =>
                  actions.update.mutate({ id: t.id, assigneeId: e.target.value || null })
                }
              >
                <option value="">Chưa giao</option>
                {people.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.status === 'offline'
                      ? ' (offline)'
                      : a.status === 'working'
                        ? ' (đang bận)'
                        : ''}
                  </option>
                ))}
                {people.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </dd>
            <dt>Ưu tiên</dt>
            <dd>
              <PriorityIcon priority={t.priority} />
              <select
                aria-label="Ưu tiên"
                value={t.priority}
                onChange={(e) =>
                  actions.update.mutate({ id: t.id, priority: e.target.value as TaskPriority })
                }
              >
                {Object.entries(PRIORITIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </dd>
            <dt>Nhãn</dt>
            <dd>
              {t.labels.map((l) => (
                <Label key={l} name={l} />
              ))}
            </dd>
            <dt>Duyệt</dt>
            <dd>
              <label className="nt-chk" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={t.requiresReview}
                  onChange={(e) =>
                    actions.update.mutate({ id: t.id, requiresReview: e.target.checked })
                  }
                />{' '}
                Cần người duyệt trước khi Xong
              </label>
            </dd>
            <dt>Tạo</dt>
            <dd style={{ color: 'var(--soft)' }}>{rel(t.createdAt, now)}</dd>
          </dl>

          {top}

          {t.description && (
            <>
              <div className="dsec">Mô tả</div>
              <div className="desc">
                <Markdown text={t.description} />
              </div>
            </>
          )}

          {t.subtasks.length > 0 && (
            <>
              <div className="dsec">
                Việc con{' '}
                <span className="r">
                  {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                </span>
              </div>
              <div className="subs">
                {t.subtasks.map((s, i) => (
                  <label key={i} className={s.done ? 'dn' : ''}>
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={(e) =>
                        actions.update.mutate({
                          id: t.id,
                          subtasks: t.subtasks.map((x, k) =>
                            k === i ? { ...x, done: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {(run || t.runs.length > 0) && (
            <>
              <div className="dsec">
                Runs <span className="r">{t.runs.length + (run ? 1 : 0)}</span>
              </div>
              <table className="runs">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Trạng thái</th>
                    <th>Thời lượng</th>
                    <th>Tools</th>
                    <th>Lúc</th>
                  </tr>
                </thead>
                <tbody>
                  {run && (
                    <tr>
                      <td>#{run.n}</td>
                      <td>
                        <span style={{ color: 'var(--claude)', fontWeight: 600 }}>running</span>
                      </td>
                      <td>{mmss(now - ms(run.startedAt))}</td>
                      <td>{run.step}</td>
                      <td style={{ color: 'var(--muted)' }}>{hhmm(ms(run.startedAt))}</td>
                    </tr>
                  )}
                  {t.runs.map((r) => (
                    <tr key={r.n}>
                      <td>#{r.n}</td>
                      <td>
                        <span style={{ color: RUN_COLOR[r.status], fontWeight: 600 }}>
                          {r.status}
                        </span>
                        {r.error && (
                          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{r.error}</div>
                        )}
                      </td>
                      <td>{r.durationSec ? dur(r.durationSec) : '–'}</td>
                      <td>{r.toolCalls}</td>
                      <td style={{ color: 'var(--muted)' }}>{rel(r.at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="dsec">Hoạt động</div>
          <ul className="act">
            {acts.map((l) => (
              <li key={l.id}>
                <Who id={l.by} size={22} />
                <div className="bd">
                  <b>{people.name(l.by)}</b>{' '}
                  {l.kind === 'comment' ? (
                    <div className="cm">
                      <Markdown text={l.text} />
                    </div>
                  ) : (
                    <span style={l.tone === 'error' ? { color: 'var(--err)' } : undefined}>
                      <Inline text={l.text} />
                    </span>
                  )}
                </div>
                <span className="t">{rel(l.at, now)}</span>
              </li>
            ))}
            {!acts.length && <li style={{ color: 'var(--muted)' }}>Chưa có hoạt động</li>}
          </ul>
          <form
            className="cmt"
            onSubmit={(e) => {
              e.preventDefault();
              submitComment();
            }}
          >
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Bình luận… gõ @ để nhắc agent"
              aria-label="Bình luận"
              autoComplete="off"
            />
            <button className="btn primary" aria-label="Gửi bình luận">
              <Icon name="send" size={14} />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

import type { TaskPriority } from '@repo/shared';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Who } from '../../components/Who';
import { useUi } from '../../stores/ui';
import { usePeople, useSession } from '../workspace/workspace.api';
import { AgentStrip } from './AgentStrip';
import { BoardView } from './BoardView';
import { ListView } from './ListView';
import { TaskDrawer } from './TaskDrawer';
import { useScheduler, useTaskActions, useTasks } from './tasks.api';
import { filterTasks, PRIORITIES } from './tasks.logic';
import { WorkloadView } from './WorkloadView';

const route = getRouteApi('/_app/tasks');
export type TasksView = 'board' | 'list' | 'agents';
const VIEWS: [TasksView, IconName, string][] = [
  ['board', 'kanban', 'Board'],
  ['list', 'list', 'Danh sách'],
  ['agents', 'gantt', 'Theo Agent'],
];

const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');

export function TasksPage() {
  const { view = 'board', task: openId } = route.useSearch();
  const navigate = route.useNavigate();
  const session = useSession().data;
  const people = usePeople();
  const tasksQuery = useTasks();
  const tasks = tasksQuery.data;
  const scheduler = useScheduler();
  const actions = useTaskActions();
  const filters = useUi((s) => s.taskFilters);
  const setFilters = useUi((s) => s.setTaskFilters);
  const openNewTask = useUi((s) => s.openNewTask);
  const anyModal = useUi(
    (s) => !!s.newTask || s.paletteOpen || s.connectComputerOpen || !!s.wizard,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  const open = (id: string) => void navigate({ search: (s) => ({ ...s, task: id }) });
  const close = () => void navigate({ search: (s) => ({ ...s, task: undefined }) });
  const toggleWho = (id: string) => setFilters({ who: filters.who === id ? null : id });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModal || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && openId)
        void navigate({ search: (s) => ({ ...s, task: undefined }) });
      if (typing()) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'c') {
        e.preventDefault();
        openNewTask('todo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyModal, openId, navigate, openNewTask]);

  const list = tasks ? filterTasks(tasks, filters) : [];
  const opened = tasks?.find((t) => t.id === openId);
  const filtered = !!(filters.who || filters.q || filters.prio);
  const live = !scheduler?.paused;

  return (
    <main className="main">
      <div className="tk">
        <div className="tk-head drag" data-tauri-drag-region>
          <div>
            <div className="crumb">{session?.workspace.name}</div>
            <h1>Tasks</h1>
          </div>
          <div className="tk-actions">
            <button
              className={`live-tg ${live ? '' : 'off'}`}
              title={
                live
                  ? 'Tạm dừng: agent ngừng chạy và không nhận việc mới'
                  : 'Tiếp tục cho agent chạy'
              }
              aria-pressed={live}
              onClick={() => actions.setPaused.mutate(live)}
            >
              <span className="pulse" />
              {live ? 'Live' : 'Tạm dừng'}
            </button>
            <div className="seg" role="tablist" aria-label="Kiểu xem">
              {VIEWS.map(([v, icon, name]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={view === v ? 'on' : ''}
                  onClick={() =>
                    void navigate({
                      search: (s) => ({ ...s, view: v === 'board' ? undefined : v }),
                    })
                  }
                >
                  <Icon name={icon} size={15} />
                  {name}
                </button>
              ))}
            </div>
            <button
              className="btn primary"
              onClick={() => openNewTask('todo')}
              title="Tạo task (c)"
            >
              <Icon name="plus" size={16} /> Task mới
            </button>
          </div>
        </div>

        {tasks && <AgentStrip tasks={tasks} who={filters.who} onFilter={toggleWho} onOpen={open} />}

        <div className="tk-tools">
          <div className="srch">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              placeholder="Tìm theo tên hoặc mã task"
              aria-label="Tìm task"
              autoComplete="off"
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              onKeyDown={(e) =>
                e.key === 'Escape' && (e.currentTarget.blur(), setFilters({ q: '' }))
              }
            />
            <kbd>/</kbd>
          </div>
          <select
            className="sel"
            aria-label="Lọc theo ưu tiên"
            value={filters.prio}
            onChange={(e) => setFilters({ prio: e.target.value as TaskPriority | '' })}
          >
            <option value="">Mọi mức ưu tiên</option>
            {Object.entries(PRIORITIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {filters.who && (
            <span className="fchip">
              <Who id={filters.who} size={16} /> {people.name(filters.who)}
              <button
                title="Bỏ lọc"
                aria-label="Bỏ lọc người làm"
                onClick={() => setFilters({ who: null })}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          <span className="tk-count">
            {list.length} task{filtered ? ' khớp bộ lọc' : ''}
          </span>
        </div>

        <div className="tk-body">
          {tasksQuery.isPending ? (
            <div className="loading">Đang tải…</div>
          ) : tasksQuery.isError ? (
            <div className="loading">Không tải được task. {tasksQuery.error.message}</div>
          ) : view === 'list' ? (
            <ListView tasks={list} onOpen={open} />
          ) : view === 'agents' ? (
            <WorkloadView tasks={tasks ?? []} who={filters.who} onOpen={open} />
          ) : (
            <BoardView
              tasks={list}
              openId={openId}
              onOpen={open}
              onApprove={(id) => actions.approve.mutate(id)}
              onMove={(id, status, beforeId) => actions.move.mutate({ id, status, beforeId })}
            />
          )}
        </div>
      </div>
      {opened && tasks && (
        <TaskDrawer key={opened.id} task={opened} tasks={tasks} onClose={close} />
      )}
    </main>
  );
}

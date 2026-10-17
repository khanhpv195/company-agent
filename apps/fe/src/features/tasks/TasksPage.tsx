import type { TaskPriority } from '@repo/shared';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Who } from '../../components/Who';
import { useT, type MessageKey } from '../../i18n';
import { useUi } from '../../stores/ui';
import { MANAGER_ONLY_HINT } from '../people/agent-form.logic';
import { useCanManage } from '../people/people.api';
import { usePeople, useSession } from '../workspace/workspace.api';
import { AgentStrip } from './AgentStrip';
import { BoardView } from './BoardView';
import { ListView } from './ListView';
import { TaskDrawer } from './TaskDrawer';
import { useScheduler, useTaskActions, useTasks } from './tasks.api';
import { filterTasks, PRIORITY_KEYS } from './tasks.logic';
import { WorkloadView } from './WorkloadView';

const route = getRouteApi('/_app/tasks');
export type TasksView = 'board' | 'list' | 'agents';
const VIEWS: [TasksView, IconName, MessageKey][] = [
  ['board', 'kanban', 'tasks.views.board'],
  ['list', 'list', 'tasks.views.list'],
  ['agents', 'gantt', 'tasks.views.agents'],
];

const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');

export function TasksPage() {
  const t = useT();
  const { view = 'board', task: openId } = route.useSearch();
  const navigate = route.useNavigate();
  const session = useSession().data;
  const people = usePeople();
  const tasksQuery = useTasks();
  const tasks = tasksQuery.data;
  const scheduler = useScheduler();
  const canManage = useCanManage();
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
            <h1>{t('tasks.title')}</h1>
          </div>
          <div className="tk-actions">
            <button
              className={`live-tg ${live ? '' : 'off'}`}
              title={
                !canManage
                  ? t(MANAGER_ONLY_HINT)
                  : live
                    ? t('tasks.pauseTip')
                    : t('tasks.resumeTip')
              }
              aria-pressed={live}
              disabled={!canManage}
              onClick={() => actions.setPaused.mutate(live)}
            >
              <span className="pulse" />
              {live ? t('tasks.live') : t('tasks.paused')}
            </button>
            <div className="seg" role="tablist" aria-label={t('tasks.viewMode')}>
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
                  {t(name)}
                </button>
              ))}
            </div>
            <button
              className="btn primary"
              onClick={() => openNewTask('todo')}
              title={t('tasks.newTaskTip')}
            >
              <Icon name="plus" size={16} /> {t('tasks.newTask')}
            </button>
          </div>
        </div>

        {tasks && <AgentStrip tasks={tasks} who={filters.who} onFilter={toggleWho} onOpen={open} />}

        <div className="tk-tools">
          <div className="srch">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              placeholder={t('tasks.searchPlaceholder')}
              aria-label={t('tasks.searchLabel')}
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
            aria-label={t('tasks.filterPriority')}
            value={filters.prio}
            onChange={(e) => setFilters({ prio: e.target.value as TaskPriority | '' })}
          >
            <option value="">{t('tasks.allPriorities')}</option>
            {Object.entries(PRIORITY_KEYS).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
          {filters.who && (
            <span className="fchip">
              <Who id={filters.who} size={16} /> {people.name(filters.who)}
              <button
                title={t('tasks.clearFilter')}
                aria-label={t('tasks.clearWho')}
                onClick={() => setFilters({ who: null })}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          <span className="tk-count">
            {t('tasks.count', { n: list.length })}
            {filtered ? t('tasks.matchingFilter') : ''}
          </span>
        </div>

        <div className="tk-body">
          {tasksQuery.isPending ? (
            <div className="loading">{t('tasks.loading')}</div>
          ) : tasksQuery.isError ? (
            <div className="loading">
              {t('tasks.loadFailed', { message: tasksQuery.error.message })}
            </div>
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

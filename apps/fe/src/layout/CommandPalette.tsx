import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { AgentAvatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useRooms } from '../features/chat/chat.api';
import { useTasks } from '../features/tasks/tasks.api';
import { StatusIcon } from '../features/tasks/task-ui';
import { usePeople } from '../features/workspace/workspace.api';
import { useT } from '../i18n';
import { useUi } from '../stores/ui';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  go: () => void;
}

/** ⌘K: jump to a page, chat, agent or task. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  if (!open) return null;
  return <Palette onClose={() => setOpen(false)} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const rooms = useRooms();
  const people = usePeople();
  const tasks = useTasks().data ?? [];
  const openNewTask = useUi((s) => s.openNewTask);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const page = (label: string, icon: IconName, to: string): Item => ({
    id: `p:${to}`,
    group: t('palette.groupPages'),
    label,
    icon: <Icon name={icon} size={16} />,
    go: run(() => void navigate({ to })),
  });
  const items: Item[] = [
    {
      id: 'new-task',
      group: t('palette.groupCommands'),
      label: t('palette.newTask'),
      hint: 'c',
      icon: <Icon name="plus" size={16} />,
      go: run(() => openNewTask('todo')),
    },
    page(t('rail.dashboard'), 'dash', '/'),
    page(t('rail.tasks'), 'kanban', '/tasks'),
    page(t('rail.chat'), 'chat', '/chat'),
    page(t('rail.people'), 'users', '/people'),
    page(t('rail.connections'), 'plug', '/connections'),
    page(t('rail.computers'), 'monitor', '/computers'),
    page(t('rail.settings'), 'sliders', '/settings'),
    ...rooms.flatMap((r) =>
      r.kind === 'dm'
        ? [
            {
              id: r.id,
              group: t('palette.groupChat'),
              label: r.name,
              hint: t('palette.dm'),
              icon: <Icon name="user" size={16} />,
              go: run(() => void navigate({ to: '/chat/$roomId', params: { roomId: r.id } })),
            },
          ]
        : r.threads.map((th) => ({
            id: th.id,
            group: t('palette.groupChat'),
            label: th.name,
            hint: `#${r.name}`,
            icon: <Icon name="chat" size={16} />,
            go: run(
              () =>
                void navigate({
                  to: '/chat/$roomId',
                  params: { roomId: r.id },
                  search: { thread: th.id },
                }),
            ),
          })),
    ),
    ...people.agents.map((a) => ({
      id: a.id,
      group: t('palette.groupAgents'),
      label: a.name,
      hint: a.status,
      icon: <AgentAvatar agent={a} size={18} />,
      go: run(() => void navigate({ to: '/people/agents/$agentId', params: { agentId: a.id } })),
    })),
    ...tasks.map((task) => ({
      id: task.id,
      group: t('palette.groupTasks'),
      label: task.title,
      hint: task.id,
      icon: <StatusIcon status={task.status} size={15} />,
      go: run(() => void navigate({ to: '/tasks', search: { task: task.id } })),
    })),
  ];
  const needle = q.trim().toLowerCase();
  const shown = (
    needle
      ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(needle))
      : items
  ).slice(0, 40);
  const active = Math.min(sel, shown.length - 1);

  return (
    <Modal onClose={onClose} label={t('palette.label')}>
      <div className="srch" style={{ width: '100%', height: 40 }}>
        <Icon name="search" size={16} />
        <input
          autoFocus
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.label')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setSel((active + step + shown.length) % shown.length);
            }
            if (e.key === 'Enter' && shown[active]) shown[active].go();
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="pal" role="listbox">
        {shown.map((item, i) => (
          <div key={item.id}>
            {(i === 0 || shown[i - 1].group !== item.group) && (
              <div className="pal-h">{item.group}</div>
            )}
            <div
              role="option"
              aria-selected={i === active}
              className={`pal-i ${i === active ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={item.go}
            >
              {item.icon}
              <span className="pal-l">{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </div>
          </div>
        ))}
        {!shown.length && (
          <div className="pal-h" style={{ textTransform: 'none' }}>
            {t('palette.empty')}
          </div>
        )}
      </div>
    </Modal>
  );
}

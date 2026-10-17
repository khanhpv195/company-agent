import type { CSSProperties } from 'react';
import type { TaskPriority, TaskStatus } from '@repo/shared';
import { useNow } from '../../lib/use-now';
import { mmss, ms } from '../../lib/format';
import { useT } from '../../i18n';
import { LABEL_COLORS, PRIORITY_KEYS, statusName } from './tasks.logic';

const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: '#a3a29c',
  todo: '#8a8a85',
  doing: '#d97757',
  review: '#c98a1b',
  done: '#6a7f2a',
};

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const t = useT();
  const c = STATUS_COLOR[status];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ flex: 'none' }}
      role="img"
      aria-label={statusName(status, t)}
    >
      {status === 'backlog' && (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={c}
          strokeWidth="1.6"
          strokeDasharray="2.3 2.1"
        />
      )}
      {status === 'todo' && <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.6" />}
      {status === 'doing' && (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M8 4.2a3.8 3.8 0 0 1 0 7.6z" fill={c} />
        </>
      )}
      {status === 'review' && (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M8 4.2a3.8 3.8 0 1 1-3.8 3.8H8z" fill={c} />
        </>
      )}
      {status === 'done' && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path
            d="m5 8.2 2 2 4-4.2"
            fill="none"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const t = useT();
  if (priority === 'urgent')
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        style={{ flex: 'none' }}
        role="img"
        aria-label={t('tasks.priority.urgent')}
      >
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="#c2453b" />
        <path d="M8 4.3v4.4M8 11.2v.3" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  const n = { high: 3, med: 2, low: 1 }[priority];
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      style={{ flex: 'none' }}
      role="img"
      aria-label={t(PRIORITY_KEYS[priority])}
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4.8}
          y={11 - i * 3.6}
          width="3.2"
          height={3.5 + i * 3.6}
          rx="1"
          fill={i < n ? 'var(--soft)' : 'var(--prio-off)'}
        />
      ))}
    </svg>
  );
}

export const Label = ({ name }: { name: string }) => (
  <span className="lbl">
    <i style={{ background: LABEL_COLORS[name] ?? '#8a8a85' }} />
    {name}
  </span>
);

/** Live m:ss since an ISO timestamp. */
export function Elapsed({
  since,
  className = 'elapsed',
  style,
}: {
  since: string;
  className?: string;
  style?: CSSProperties;
}) {
  const now = useNow();
  return (
    <span className={className} style={style}>
      {mmss(now - ms(since))}
    </span>
  );
}

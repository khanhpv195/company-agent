import type { Agent, Member } from '@repo/shared';
import type { CSSProperties } from 'react';

const BG = ['#d8f0ec', '#f3e6d4', '#e5e3f5'];
const HEAD = ['#f4a6c7', '#e9b46b', '#a8a2e6'];
const BODY = ['#1f6f7a', '#7a5a1f', '#3f3a8a'];

/** Generated agent creature (original art). */
export function AgentArt({ variant }: { variant: number }) {
  const v = variant % BG.length;
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
      <rect width="40" height="40" fill={BG[v]} />
      <ellipse cx="20" cy="13" rx="9" ry="7" fill={HEAD[v]} />
      <path d="M5 32c0-8 7-12 15-12s15 4 15 12v8H5z" fill={BODY[v]} />
      <ellipse cx="14.5" cy="27" rx="4" ry="3.2" fill="#fff" />
      <ellipse cx="25.5" cy="27" rx="4" ry="3.2" fill="#fff" />
      <circle cx="15.5" cy="27.6" r="1.6" fill="#111" />
      <circle cx="26.5" cy="27.6" r="1.6" fill="#111" />
    </svg>
  );
}

const box = (size?: number, style?: CSSProperties): CSSProperties | undefined =>
  size ? { width: size, height: size, ...style } : style;

export function AgentAvatar({
  agent,
  size,
  className,
}: {
  agent: Pick<Agent, 'avatar' | 'name'>;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`av ${className ?? ''}`} style={box(size)} title={agent.name}>
      <AgentArt variant={agent.avatar} />
    </span>
  );
}

export function MemberAvatar({
  member,
  size,
  className,
}: {
  member: Pick<Member, 'name' | 'color'>;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`av human ${className ?? ''}`}
      style={box(size, {
        ...(member.color ? { background: member.color } : null),
        ...(size ? { fontSize: Math.round(size * 0.5) } : null),
      })}
      title={member.name}
    >
      {member.name[0].toLowerCase()}
    </span>
  );
}

/** Dashed circle for "not assigned". */
export const NoAvatar = ({ size = 20 }: { size?: number }) => (
  <span className="av-none" style={{ width: size, height: size }} title="Chưa giao" />
);

import type { Presence } from './presence';

export const Dot = ({ state, style }: { state: Presence; style?: CSSProperties }) => (
  <span className={`dot ${state}`} style={style} />
);

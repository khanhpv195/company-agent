import type { PinItem, Room, Thread } from '@repo/shared';
import { Link } from '@tanstack/react-router';
import { AgentAvatar } from '../../components/Avatar';
import { DemoBadge } from '../../components/DemoBadge';
import { Dot } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { agentPresence } from '../../components/presence';
import { useT } from '../../i18n';
import { short } from '../../lib/format';
import { usePeople } from '../workspace/workspace.api';
import { capCount } from './chat.sidebar';

/** Unread and mention badges. A muted place only shows its mentions. */
export function Badges({
  unread = 0,
  mentions = 0,
  muted = false,
}: {
  unread?: number;
  mentions?: number;
  muted?: boolean;
}) {
  const t = useT();
  return (
    <>
      {!muted && unread > 0 && (
        <span className="badge" aria-label={t('chat.unreadCount', { n: unread })}>
          {capCount(unread)}
        </span>
      )}
      {mentions > 0 && (
        <span className="badge mention" aria-label={t('chat.mentionCount', { n: mentions })}>
          @{capCount(mentions)}
        </span>
      )}
    </>
  );
}

function Working({ on }: { on: boolean }) {
  const t = useT();
  if (!on) return null;
  return (
    <span className="working" title={t('chat.working')}>
      <span className="mini-spin" aria-hidden="true" />
      <span className="sr-only">{t('chat.working')}</span>
    </span>
  );
}

/** A channel row: icon, name, lock, working spinner, badges. */
export function ChannelRow({ room, active }: { room: Room; active: boolean }) {
  const t = useT();
  const unread = !room.muted && (room.unread ?? 0) > 0;
  return (
    <Link
      to="/chat/$roomId"
      params={{ roomId: room.id }}
      className={`srow${active ? ' on' : ''}${room.muted ? ' muted' : ''}${unread ? ' unread' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={room.icon} size={16} />
      <span className="name">{room.name}</span>
      {room.isPrivate && (
        <span className="lock" title={t('chat.private')}>
          <Icon name="lock" size={12} />
          <span className="sr-only">{t('chat.private')}</span>
        </span>
      )}
      <Working on={!!room.workingAgentIds?.length} />
      <Badges unread={room.unread} mentions={room.mentions} muted={room.muted} />
    </Link>
  );
}

/** A DM row: the agent's avatar, presence dot, name and last message. */
export function DmRow({ room, active, now }: { room: Room; active: boolean; now: number }) {
  const people = usePeople();
  const agent = people.agent(room.agentId);
  const unread = !room.muted && (room.unread ?? 0) > 0;
  return (
    <Link
      to="/chat/$roomId"
      params={{ roomId: room.id }}
      className={`item${active ? ' on' : ''}${room.muted ? ' muted' : ''}${unread ? ' unread' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {agent ? <AgentAvatar agent={agent} /> : <span className="av human">{room.name[0]}</span>}
      <div className="meta">
        <div className="row">
          <span className="name">
            {agent && <Dot state={agentPresence(agent.status)} style={{ marginRight: 6 }} />}
            {agent?.name ?? room.name}
            {agent?.simulated && <DemoBadge />}
          </span>
          <span className="time">
            <Working on={!!room.workingAgentIds?.length} />
            <Badges unread={room.unread} mentions={room.mentions} muted={room.muted} />
            {!room.unread && !room.mentions && short(room.lastMessageAt, now)}
          </span>
        </div>
        <div className="prev">{room.preview}</div>
      </div>
    </Link>
  );
}

/** A thread row (in Recent): title and the room it lives in. */
export function ThreadRow({
  room,
  thread,
  active,
}: {
  room: Room;
  thread: Thread;
  active: boolean;
}) {
  const unread = !thread.muted && thread.unread > 0;
  return (
    <Link
      to="/chat/$roomId"
      params={{ roomId: room.id }}
      search={{ thread: thread.id }}
      className={`srow${active ? ' on' : ''}${thread.muted ? ' muted' : ''}${unread ? ' unread' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name="thread" size={16} />
      <span className="name">{thread.name}</span>
      <span className="sub">#{room.name}</span>
      <Badges unread={thread.unread} mentions={thread.mentions} muted={thread.muted} />
    </Link>
  );
}

const PIN_ICON: Record<PinItem['targetType'], IconName> = {
  room: 'hash',
  thread: 'thread',
  message: 'pin',
};

/** A pinned room, thread or message. */
export function PinRow({ pin, active }: { pin: PinItem; active: boolean }) {
  return (
    <Link
      to="/chat/$roomId"
      params={{ roomId: pin.roomId }}
      search={
        pin.targetType === 'room'
          ? {}
          : { thread: pin.threadRootId ?? undefined, message: pin.messageId ?? undefined }
      }
      className={`srow${active ? ' on' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={PIN_ICON[pin.targetType]} size={16} />
      <span className="name">{pin.title}</span>
      {pin.targetType !== 'room' && <span className="sub">#{pin.roomName}</span>}
    </Link>
  );
}

import type { Agent, Room } from '@repo/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AgentAvatar } from '../../components/Avatar';
import { DemoBadge } from '../../components/DemoBadge';
import { Icon } from '../../components/Icon';
import { agentPresence } from '../../components/presence';
import { Dot } from '../../components/Avatar';
import { useT } from '../../i18n';
import { useSession } from '../workspace/workspace.api';
import { flattenTimeline } from './chat.cache';
import { usePins, useRoomTimeline, useToggleMute, useTogglePin } from './chat.api';
import {
  DeleteRoomDialog,
  LeaveRoomDialog,
  MembersDialog,
  RoomSettingsDialog,
} from './RoomDialogs';

/**
 * Room header: icon, name, lock, members, find, mute, pin, and the room menu.
 */
export function RoomHeader({ room, dmAgent }: { room: Room; dmAgent?: Agent }) {
  const t = useT();
  const navigate = useNavigate();
  const role = useSession().data?.user.role;
  const pins = usePins();
  const togglePin = useTogglePin();
  const mute = useToggleMute(room.id);
  const pin = pins.find((p) => p.targetType === 'room' && p.targetId === room.id);
  const muted = !!room.muted;
  const members = (room.memberCount ?? 0) + (room.agentCount ?? 0);
  const [menu, setMenu] = useState(false);
  const [finding, setFinding] = useState(false);
  const [panel, setPanel] = useState<'members' | 'settings' | 'leave' | 'delete' | null>(null);
  const canManage = room.myRole === 'owner' || role === 'owner' || role === 'admin';
  const channel = room.kind === 'channel' && room.icon !== 'inbox';

  return (
    <div className="chat-head drag" data-tauri-drag-region>
      {room.kind === 'dm' ? (
        dmAgent && <AgentAvatar agent={dmAgent} size={26} />
      ) : (
        <span className="room-ico" aria-hidden="true">
          <Icon name={room.icon} size={18} />
        </span>
      )}
      <div className="head-main">
        <div className="title">
          {room.kind === 'dm' ? (dmAgent?.name ?? room.name) : room.name}
          {room.isPrivate && room.kind === 'channel' && (
            <span className="lock" title={t('chat.private')}>
              <Icon name="lock" size={13} />
              <span className="sr-only">{t('chat.private')}</span>
            </span>
          )}
          {dmAgent && <span className="spark">✳</span>}
          {dmAgent?.simulated && <DemoBadge />}
          {dmAgent && <Dot state={agentPresence(dmAgent.status)} style={{ marginLeft: 8 }} />}
        </div>
      </div>
      <div className="right">
        {room.kind === 'channel' && (
          <button
            type="button"
            className="icon-btn members-btn"
            title={t('chat.room.membersTitle')}
            aria-label={t('chat.members', { n: members })}
            onClick={() => setPanel('members')}
          >
            <Icon name="users" size={16} />
            <span>{members}</span>
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          title={t('chat.room.find')}
          aria-label={t('chat.room.find')}
          aria-expanded={finding}
          onClick={() => setFinding((v) => !v)}
        >
          <Icon name="search" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={muted}
          disabled={mute.isPending}
          title={muted ? t('chat.unmute') : t('chat.mute')}
          aria-label={muted ? t('chat.unmute') : t('chat.mute')}
          onClick={() => mute.mutate(!muted)}
        >
          <Icon name={muted ? 'bellOff' : 'bell'} size={17} />
        </button>
        <button
          type="button"
          className={`icon-btn${pin ? ' on' : ''}`}
          aria-pressed={!!pin}
          disabled={togglePin.isPending}
          title={pin ? t('chat.unpin') : t('chat.pin')}
          aria-label={pin ? t('chat.unpin') : t('chat.pin')}
          onClick={() =>
            togglePin.mutate({ pinId: pin?.id, targetType: 'room', targetId: room.id })
          }
        >
          <Icon name="pin" size={17} />
        </button>
        {channel && (
          <div className="new-menu">
            <button
              type="button"
              className="icon-btn"
              aria-haspopup="menu"
              aria-expanded={menu}
              title={t('chat.more')}
              aria-label={t('chat.more')}
              onClick={() => setMenu((v) => !v)}
            >
              <Icon name="more" />
            </button>
            {menu && (
              <div className="pop-menu" role="menu">
                {canManage && (
                  <button
                    type="button"
                    role="menuitem"
                    className="pop-item"
                    onClick={() => {
                      setMenu(false);
                      setPanel('settings');
                    }}
                  >
                    <Icon name="sliders" size={15} />
                    <span>{t('chat.room.settings')}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    setMenu(false);
                    setPanel('leave');
                  }}
                >
                  <Icon name="logout" size={15} />
                  <span>{t('chat.room.leave')}</span>
                </button>
                {canManage && !room.isDefault && (
                  <button
                    type="button"
                    role="menuitem"
                    className="pop-item danger"
                    onClick={() => {
                      setMenu(false);
                      setPanel('delete');
                    }}
                  >
                    <Icon name="x" size={15} />
                    <span>{t('chat.room.delete')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {finding && (
        <FindInRoom
          roomId={room.id}
          onClose={() => setFinding(false)}
          onPick={(id) => {
            setFinding(false);
            void navigate({
              to: '/chat/$roomId',
              params: { roomId: room.id },
              search: { message: id },
            });
          }}
        />
      )}
      {panel === 'members' && <MembersDialog room={room} onClose={() => setPanel(null)} />}
      {panel === 'settings' && <RoomSettingsDialog room={room} onClose={() => setPanel(null)} />}
      {panel === 'leave' && <LeaveRoomDialog room={room} onClose={() => setPanel(null)} />}
      {panel === 'delete' && <DeleteRoomDialog room={room} onClose={() => setPanel(null)} />}
    </div>
  );
}

function FindInRoom({
  roomId,
  onPick,
  onClose,
}: {
  roomId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const timeline = useRoomTimeline(roomId);
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return flattenTimeline(timeline.data)
      .filter((m) => !m.deleted && m.markdown.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [q, timeline.data]);
  return (
    <div className="find-pop">
      <input
        className="field"
        autoFocus
        value={q}
        placeholder={t('chat.room.find')}
        aria-label={t('chat.room.find')}
        onChange={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="find-hits">
        {q.trim() && hits.length === 0 && <p>{t('chat.room.findEmpty')}</p>}
        {hits.map((m) => (
          <button key={m.id} type="button" className="find-hit" onClick={() => onPick(m.id)}>
            {m.markdown.replace(/\s+/g, ' ').slice(0, 140)}
          </button>
        ))}
      </div>
    </div>
  );
}

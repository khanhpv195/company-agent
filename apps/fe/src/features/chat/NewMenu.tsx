import { useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { useChatStore } from '../../stores/chat';
import { useUi } from '../../stores/ui';
import { useLimitGuard } from '../billing/billing.api';
import { useCanManage } from '../people/people.api';
import { InviteModal } from '../settings/MembersSection';
import { canInvite } from '../settings/settings.logic';
import { useSession } from '../workspace/workspace.api';
import { JoinRoomDialog, NewRoomDialog } from './RoomDialogs';

/** The "+" menu of the chat sidebar. */
export function NewMenu() {
  const t = useT();
  const params = useParams({ strict: false });
  const roomId = 'roomId' in params ? params.roomId : undefined;
  const requestNewThread = useChatStore((s) => s.requestNewThread);
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [dialog, setDialog] = useState<'room' | 'join' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const role = useSession().data?.user.role;
  const canManage = useCanManage();
  const agentLimit = useLimitGuard('agents');
  const seatLimit = useLimitGuard('seats');
  const openNewAgent = useUi((s) => s.openNewAgent);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (
    label: string,
    opts: {
      onClick?: () => void;
      disabled?: boolean;
      hint?: string;
      icon: 'pen' | 'hash' | 'plug' | 'sparkles' | 'users';
    },
  ) => (
    <button
      type="button"
      role="menuitem"
      className="pop-item"
      disabled={opts.disabled}
      title={opts.hint}
      onClick={() => {
        setOpen(false);
        opts.onClick?.();
      }}
    >
      <Icon name={opts.icon} size={15} />
      <span>{label}</span>
      {opts.disabled && opts.hint === t('chat.soon') && <small>{t('chat.soon')}</small>}
    </button>
  );

  return (
    <div className="new-menu" ref={box}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('chat.new')}
        aria-label={t('chat.new')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="plus" size={18} />
      </button>
      {open && (
        <div className="pop-menu" role="menu" aria-label={t('chat.new')}>
          {item(t('chat.menu.newThread'), {
            icon: 'pen',
            disabled: !roomId,
            hint: roomId ? undefined : t('chat.menu.needRoom'),
            onClick: () => requestNewThread(),
          })}
          {item(t('chat.menu.newRoom'), { icon: 'hash', onClick: () => setDialog('room') })}
          {item(t('chat.menu.joinRoom'), { icon: 'plug', onClick: () => setDialog('join') })}
          {canManage &&
            item(t('chat.menu.newAgent'), {
              icon: 'sparkles',
              disabled: agentLimit.blocked,
              hint: agentLimit.title,
              onClick: () => openNewAgent(),
            })}
          {canInvite(role) &&
            item(t('chat.menu.invite'), {
              icon: 'users',
              disabled: seatLimit.blocked,
              hint: seatLimit.title,
              onClick: () => setInviting(true),
            })}
        </div>
      )}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {dialog === 'room' && <NewRoomDialog onClose={() => setDialog(null)} />}
      {dialog === 'join' && <JoinRoomDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

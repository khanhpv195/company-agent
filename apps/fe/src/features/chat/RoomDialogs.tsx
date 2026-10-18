import type { Agent, BrowseRoom, Member, Room } from '@repo/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { useAgents, useMembers, useSession } from '../workspace/workspace.api';
import {
  useAddRoomMembers,
  useBrowseRooms,
  useCreateRoom,
  useDeleteRoom,
  useJoinRoom,
  useLeaveRoom,
  useRemoveRoomMember,
  useRoomMembers,
  useUpdateRoom,
} from './chat.api';

function errText(e: unknown): string | null {
  return e instanceof Error ? e.message : null;
}

/** Three steps: name, public or private, then people and agents. */
export function NewRoomDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateRoom();
  const members = useMembers();
  const agents = useAgents();
  const me = useSession().data?.user.id;
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);

  const toggle = (list: string[], id: string, set: (ids: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = () => {
    create.mutate(
      {
        name: name.trim(),
        isPrivate,
        memberIds,
        agentIds,
      },
      {
        onSuccess: (room) => {
          onClose();
          void navigate({ to: '/chat/$roomId', params: { roomId: room.id } });
        },
      },
    );
  };

  const people = members.filter((m) => m.id !== me);

  return (
    <Modal onClose={onClose} label={t('chat.room.newTitle')}>
      <h3>{t('chat.room.newTitle')}</h3>
      <p>{t('chat.room.step', { n: step })}</p>
      {step === 1 && (
        <label className="field-label">
          {t('chat.room.name')}
          <input
            className="field"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
      )}
      {step === 2 && (
        <div className="choice-list">
          <label className={`choice${!isPrivate ? ' on' : ''}`}>
            <input
              type="radio"
              name="scope"
              checked={!isPrivate}
              onChange={() => setIsPrivate(false)}
            />
            <span>
              <b>{t('chat.room.public')}</b>
              <small>{t('chat.room.publicHint')}</small>
            </span>
          </label>
          <label className={`choice${isPrivate ? ' on' : ''}`}>
            <input
              type="radio"
              name="scope"
              checked={isPrivate}
              onChange={() => setIsPrivate(true)}
            />
            <span>
              <b>{t('chat.room.private')}</b>
              <small>{t('chat.room.privateHint')}</small>
            </span>
          </label>
        </div>
      )}
      {step === 3 && (
        <>
          <PartyPicker
            people={people}
            agents={agents}
            memberIds={memberIds}
            agentIds={agentIds}
            onToggleMember={(id) => toggle(memberIds, id, setMemberIds)}
            onToggleAgent={(id) => toggle(agentIds, id, setAgentIds)}
          />
          {agentIds.length > 0 && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
              />
              {t('chat.room.consent')}
            </label>
          )}
        </>
      )}
      {errText(create.error) && <div className="err-line">{errText(create.error)}</div>}
      <div className="modal-actions">
        {step > 1 ? (
          <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
            {t('chat.room.back')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            {t('chat.actions.cancel')}
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            className="btn primary"
            disabled={step === 1 && !name.trim()}
            onClick={() => setStep((s) => s + 1)}
          >
            {t('chat.room.next')}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={create.isPending || (agentIds.length > 0 && !consent)}
            onClick={submit}
          >
            {t('chat.room.create')}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function JoinRoomDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const browse = useBrowseRooms(true);
  const join = useJoinRoom();
  const [q, setQ] = useState('');
  const rooms = (browse.data ?? []).filter((r) =>
    r.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const go = (room: BrowseRoom) =>
    join.mutate(room.id, {
      onSuccess: (joined) => {
        onClose();
        void navigate({ to: '/chat/$roomId', params: { roomId: joined.id } });
      },
    });

  return (
    <Modal onClose={onClose} label={t('chat.room.joinTitle')}>
      <h3>{t('chat.room.joinTitle')}</h3>
      <input
        className="field"
        value={q}
        placeholder={t('chat.room.search')}
        aria-label={t('chat.room.search')}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <div className="party-list">
        {browse.isLoading && <p>{t('chat.loading')}</p>}
        {!browse.isLoading && rooms.length === 0 && <p>{t('chat.room.joinEmpty')}</p>}
        {rooms.map((r) => (
          <div key={r.id} className="party-row">
            <Icon name="hash" size={15} />
            <span className="name">{r.name}</span>
            <small>
              {t('chat.members', { n: r.memberCount })} · {r.agentCount}
            </small>
            <button
              type="button"
              className="btn sm primary"
              disabled={join.isPending}
              onClick={() => go(r)}
            >
              {t('chat.room.join')}
            </button>
          </div>
        ))}
      </div>
      {errText(join.error) && <div className="err-line">{errText(join.error)}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('chat.actions.cancel')}
        </button>
      </div>
    </Modal>
  );
}

export function MembersDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const t = useT();
  const me = useSession().data?.user.id;
  const role = useSession().data?.user.role;
  const query = useRoomMembers(room.id);
  const add = useAddRoomMembers(room.id);
  const remove = useRemoveRoomMember(room.id);
  const members = useMembers();
  const agents = useAgents();
  const [adding, setAdding] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const data = query.data;
  const canManage =
    room.myRole === 'owner' || role === 'owner' || role === 'admin' || !room.isPrivate;

  const outside = useMemo(() => {
    const inMembers = new Set(data?.members.map((m) => m.memberId) ?? []);
    const inAgents = new Set(data?.agents.map((a) => a.agentId) ?? []);
    return {
      people: members.filter((m) => m.id !== me && !inMembers.has(m.id)),
      agents: agents.filter((a) => !inAgents.has(a.id)),
    };
  }, [data, members, agents, me]);

  const submitAdd = () => {
    add.mutate(
      { memberIds, agentIds },
      {
        onSuccess: () => {
          setAdding(false);
          setMemberIds([]);
          setAgentIds([]);
          setConsent(false);
        },
      },
    );
  };

  return (
    <Modal onClose={onClose} label={t('chat.room.membersTitle')}>
      <h3>{t('chat.room.membersTitle')}</h3>
      <div className="party-list">
        {data?.members.map((m) => (
          <div key={m.memberId} className="party-row">
            <span className="av human" style={m.color ? { background: m.color } : undefined}>
              {m.name[0]?.toLowerCase()}
            </span>
            <span className="name">
              {m.name}
              {m.memberId === me ? ` (${t('chat.room.you')})` : ''}
            </span>
            <small>{m.role === 'owner' ? t('chat.room.owner') : t('chat.kind.member')}</small>
            {canManage && m.memberId !== me && (
              <button
                type="button"
                className="btn sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ kind: 'member', targetId: m.memberId })}
              >
                {t('chat.room.remove')}
              </button>
            )}
          </div>
        ))}
        {data?.agents.map((a) => (
          <div key={a.agentId} className="party-row">
            <span className="av">✳</span>
            <span className="name">{a.name}</span>
            <small>{t('chat.kind.agent')}</small>
            {canManage && (
              <button
                type="button"
                className="btn sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ kind: 'agent', targetId: a.agentId })}
              >
                {t('chat.room.remove')}
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && !adding && (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          {t('chat.room.add')}
        </button>
      )}
      {adding && (
        <>
          <PartyPicker
            people={outside.people}
            agents={outside.agents}
            memberIds={memberIds}
            agentIds={agentIds}
            onToggleMember={(id) =>
              setMemberIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
            }
            onToggleAgent={(id) =>
              setAgentIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
            }
          />
          {agentIds.length > 0 && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
              />
              {t('chat.room.consent')}
            </label>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={
              add.isPending ||
              (memberIds.length === 0 && agentIds.length === 0) ||
              (agentIds.length > 0 && !consent)
            }
            onClick={submitAdd}
          >
            {t('chat.room.add')}
          </button>
        </>
      )}
      {errText(add.error ?? remove.error) && (
        <div className="err-line">{errText(add.error ?? remove.error)}</div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('chat.actions.cancel')}
        </button>
      </div>
    </Modal>
  );
}

export function RoomSettingsDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const t = useT();
  const update = useUpdateRoom(room.id);
  const [name, setName] = useState(room.name);
  const [isPrivate, setIsPrivate] = useState(room.isPrivate);
  const locked = !!room.isDefault;
  const save = () =>
    update.mutate(
      { ...(locked ? null : { name: name.trim() }), ...(locked ? null : { isPrivate }) },
      { onSuccess: () => onClose() },
    );

  return (
    <Modal onClose={onClose} label={t('chat.room.settings')}>
      <h3>{t('chat.room.settings')}</h3>
      <label className="field-label">
        {t('chat.room.name')}
        <input
          className="field"
          value={name}
          maxLength={80}
          disabled={locked}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </label>
      {locked && <p>{t('chat.room.nameLocked')}</p>}
      {!locked && (
        <label className="check-line">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.currentTarget.checked)}
          />
          {t('chat.room.private')} — {t('chat.room.privateHint')}
        </label>
      )}
      {errText(update.error) && <div className="err-line">{errText(update.error)}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('chat.actions.cancel')}
        </button>
        {!locked && (
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || update.isPending}
            onClick={save}
          >
            {t('chat.room.save')}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function DeleteRoomDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const remove = useDeleteRoom();
  const [typed, setTyped] = useState('');
  const go = () =>
    remove.mutate(room.id, {
      onSuccess: () => {
        onClose();
        void navigate({ to: '/chat' });
      },
    });
  return (
    <Modal onClose={onClose} label={t('chat.room.deleteTitle', { name: room.name })}>
      <h3>{t('chat.room.deleteTitle', { name: room.name })}</h3>
      <p>{t('chat.room.deleteHint')}</p>
      <input
        className="field"
        value={typed}
        aria-label={t('chat.room.name')}
        onChange={(e) => setTyped(e.currentTarget.value)}
      />
      {errText(remove.error) && <div className="err-line">{errText(remove.error)}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('chat.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={typed !== room.name || remove.isPending}
          onClick={go}
        >
          {t('chat.room.deleteConfirm')}
        </button>
      </div>
    </Modal>
  );
}

export function LeaveRoomDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const leave = useLeaveRoom();
  return (
    <Modal onClose={onClose} label={t('chat.room.leaveTitle')}>
      <h3>{t('chat.room.leaveTitle')}</h3>
      <p>{room.name}</p>
      {errText(leave.error) && <div className="err-line">{errText(leave.error)}</div>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('chat.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={leave.isPending}
          onClick={() =>
            leave.mutate(room.id, {
              onSuccess: () => {
                onClose();
                void navigate({ to: '/chat' });
              },
            })
          }
        >
          {t('chat.room.leave')}
        </button>
      </div>
    </Modal>
  );
}

function PartyPicker({
  people,
  agents,
  memberIds,
  agentIds,
  onToggleMember,
  onToggleAgent,
}: {
  people: Member[];
  agents: Agent[];
  memberIds: string[];
  agentIds: string[];
  onToggleMember: (id: string) => void;
  onToggleAgent: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="party-list">
      <div className="h">{t('chat.room.pickMembers')}</div>
      {people.map((m) => (
        <label key={m.id} className="party-row">
          <input
            type="checkbox"
            checked={memberIds.includes(m.id)}
            onChange={() => onToggleMember(m.id)}
          />
          <span className="name">{m.name}</span>
          <small>{t('chat.kind.member')}</small>
        </label>
      ))}
      {agents.map((a) => (
        <label key={a.id} className="party-row">
          <input
            type="checkbox"
            checked={agentIds.includes(a.id)}
            onChange={() => onToggleAgent(a.id)}
          />
          <span className="name">{a.name}</span>
          <small>{t('chat.kind.agent')}</small>
        </label>
      ))}
    </div>
  );
}

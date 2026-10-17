import { useLimitGuard } from '../billing/billing.api';
import { LimitHint } from '../billing/LimitHint';
import type { AssignableRole, CreateInviteResult, Member } from '@repo/shared';
import { useRef, useState } from 'react';
import { MemberAvatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { formatRelativeSeconds, useT } from '../../i18n';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/error-message';
import { useNow } from '../../lib/use-now';
import { isEmail } from '../auth/auth.logic';
import { ROLE_NAME, useMembers, useSession } from '../workspace/workspace.api';
import { useNotify } from './settings.api';
import {
  canChangeRole,
  canInvite,
  canInviteAdmin,
  canRemove,
  inviteLinkOf,
  transferCandidates,
} from './settings.logic';
import {
  useChangeMemberRole,
  useCreateInvite,
  useInvites,
  useRemoveMember,
  useRevokeInvite,
  useTransferOwnership,
} from './team.api';

export function MembersSection() {
  const t = useT();
  const session = useSession().data;
  const members = useMembers();
  const me = session?.user;
  const actor = { id: me?.id ?? '', role: me?.role };
  const manager = canInvite(me?.role);
  const seatLimit = useLimitGuard('seats');
  const [inviting, setInviting] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const changeRole = useChangeMemberRole();
  const notify = useNotify();

  return (
    <div className="set-stack wide">
      <div className="box set-box wide">
        <div className="set-head">
          <h4>{t('settings.members.listTitle', { count: members.length })}</h4>
          {manager && (
            <div className="limit-row">
              <LimitHint guard={seatLimit} />
              <button
                className="btn primary"
                disabled={seatLimit.blocked}
                title={seatLimit.title}
                onClick={() => setInviting(true)}
              >
                {t('settings.members.invite')}
              </button>
            </div>
          )}
        </div>
        <ul className="session-list">
          {members.map((m) => {
            const isMe = m.id === me?.id;
            return (
              <li key={m.id}>
                <MemberAvatar member={m} size={30} />
                <div className="grow">
                  <div className="dev">
                    {m.name}
                    {isMe && <span className="pill this">{t('settings.members.you')}</span>}
                  </div>
                  <div className="when">{m.email}</div>
                </div>
                {canChangeRole(actor, m) ? (
                  <select
                    className="sel"
                    aria-label={t('settings.members.roleOf', { name: m.name })}
                    value={m.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate(
                        { id: m.id, role: e.target.value as AssignableRole },
                        { onSuccess: () => notify(t('settings.members.roleChanged')) },
                      )
                    }
                  >
                    <option value="admin">{ROLE_NAME.admin}</option>
                    <option value="member">{ROLE_NAME.member}</option>
                  </select>
                ) : (
                  <span className={`role-badge ${m.role}`}>{ROLE_NAME[m.role]}</span>
                )}
                {canRemove(actor, m) && (
                  <button className="btn" onClick={() => setRemoving(m)}>
                    {t('settings.members.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {changeRole.error && (
          <div className="err-line" role="alert">
            {errorMessage(changeRole.error, t, 'settings.members.roleFailed')}
          </div>
        )}
        {me?.role === 'owner' && (
          <div className="set-row">
            <button
              className="btn"
              disabled={transferCandidates(actor, members).length === 0}
              onClick={() => setTransferring(true)}
            >
              {t('settings.members.transfer')}
            </button>
          </div>
        )}
      </div>
      {manager && <InvitesBox />}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {removing && <RemoveModal member={removing} onClose={() => setRemoving(null)} />}
      {transferring && <TransferModal onClose={() => setTransferring(false)} />}
    </div>
  );
}

function InvitesBox() {
  const t = useT();
  const invites = useInvites(true);
  const revoke = useRevokeInvite();
  const notify = useNotify();
  const now = useNow();
  const list = invites.data ?? [];
  return (
    <div className="box set-box wide">
      <h4>{t('settings.members.pendingTitle')}</h4>
      {invites.isSuccess && list.length === 0 && (
        <div className="set-empty">{t('settings.members.noPending')}</div>
      )}
      <ul className="session-list">
        {list.map((inv) => (
          <li key={inv.id}>
            <div className="grow">
              <div className="dev">
                {inv.email}
                <span className={`role-badge ${inv.role} inline`}>{ROLE_NAME[inv.role]}</span>
              </div>
              <div className="when">
                {t('settings.members.expires', {
                  when: formatRelativeSeconds((now - Date.parse(inv.expiresAt)) / 1000),
                })}
                {inv.invitedByName
                  ? ` · ${t('settings.members.invitedBy', { name: inv.invitedByName })}`
                  : ''}
              </div>
            </div>
            <button
              className="btn"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(inv.id, { onSuccess: () => notify(t('settings.members.revoked')) })
              }
            >
              {t('settings.members.revoke')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const notify = useNotify();
  const id = `copy-${label.replace(/\W+/g, '')}`;
  const fieldRef = useRef<HTMLInputElement>(null);
  const copy = async () => {
    if (await copyText(value, fieldRef.current)) notify(t('settings.members.copied'));
    else notify(t('settings.members.copyFailed'), true);
  };
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="copy-row">
        <input
          id={id}
          ref={fieldRef}
          className="field"
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn" onClick={() => void copy()}>
          {t('settings.members.copy')}
        </button>
      </div>
    </>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const role = useSession().data?.user.role;
  const create = useCreateInvite();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('member');
  const [result, setResult] = useState<CreateInviteResult | null>(null);
  const ready = isEmail(email);

  if (result)
    return (
      <Modal onClose={onClose} label={t('settings.members.inviteDoneTitle')}>
        <h3>{t('settings.members.inviteDoneTitle')}</h3>
        <p>{t('settings.members.inviteDoneBody', { email: result.invite.email })}</p>
        <CopyField
          label={t('settings.members.link')}
          value={inviteLinkOf(result, window.location.origin)}
        />
        <CopyField label={t('settings.members.code')} value={result.token} />
        <div className="field-hint">{t('settings.members.mailNote')}</div>
        <div className="set-row end">
          <button className="btn primary" onClick={onClose}>
            {t('settings.members.done')}
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal onClose={onClose} label={t('settings.members.inviteTitle')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready)
            create.mutate({ email: email.trim(), role: inviteRole }, { onSuccess: setResult });
        }}
      >
        <h3>{t('settings.members.inviteTitle')}</h3>
        <label htmlFor="inv-email">{t('settings.members.email')}</label>
        <input
          id="inv-email"
          className="field"
          type="email"
          autoComplete="off"
          placeholder={t('settings.members.emailPlaceholder')}
          value={email}
          aria-invalid={!!create.error || undefined}
          aria-describedby={create.error ? 'inv-error' : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="inv-role">{t('settings.members.role')}</label>
        <select
          id="inv-role"
          className="field"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
        >
          {canInviteAdmin(role) && <option value="admin">{ROLE_NAME.admin}</option>}
          <option value="member">{ROLE_NAME.member}</option>
        </select>
        {create.error && (
          <div id="inv-error" className="err-line" role="alert">
            {errorMessage(create.error, t, 'settings.members.inviteFailed')}
          </div>
        )}
        <div className="set-row end">
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.security.cancel')}
          </button>
          <button className="btn primary" disabled={!ready || create.isPending}>
            {t('settings.members.sendInvite')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const t = useT();
  const notify = useNotify();
  const remove = useRemoveMember();
  return (
    <Modal onClose={onClose} label={t('settings.members.removeTitle')}>
      <h3>{t('settings.members.removeTitle')}</h3>
      <p>{t('settings.members.removeBody', { name: member.name })}</p>
      {remove.error && (
        <div className="err-line" role="alert">
          {errorMessage(remove.error, t, 'settings.members.removeFailed')}
        </div>
      )}
      <div className="set-row end">
        <button type="button" className="btn" onClick={onClose}>
          {t('settings.security.cancel')}
        </button>
        <button
          className="btn danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(member.id, {
              onSuccess: () => {
                notify(t('settings.members.removed'));
                onClose();
              },
            })
          }
        >
          {t('settings.members.removeConfirm')}
        </button>
      </div>
    </Modal>
  );
}

function TransferModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const notify = useNotify();
  const me = useSession().data?.user;
  const members = useMembers();
  const candidates = transferCandidates({ id: me?.id ?? '', role: me?.role }, members);
  const transfer = useTransferOwnership();
  const [target, setTarget] = useState(candidates[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const ready = !!target && password.length > 0;
  return (
    <Modal onClose={onClose} label={t('settings.members.transferTitle')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          transfer.mutate(
            { memberId: target, password },
            {
              onSuccess: () => {
                notify(t('settings.members.transferred'));
                onClose();
              },
            },
          );
        }}
      >
        <h3>{t('settings.members.transferTitle')}</h3>
        <p>{t('settings.members.transferBody')}</p>
        <label htmlFor="tr-member">{t('settings.members.transferTo')}</label>
        <select
          id="tr-member"
          className="field"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.email})
            </option>
          ))}
        </select>
        <label htmlFor="tr-password">{t('settings.members.yourPassword')}</label>
        <input
          id="tr-password"
          className="field"
          type="password"
          name="transfer-confirm-password"
          autoComplete="current-password"
          value={password}
          aria-invalid={!!transfer.error || undefined}
          aria-describedby={transfer.error ? 'tr-error' : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {transfer.error && (
          <div id="tr-error" className="err-line" role="alert">
            {errorMessage(transfer.error, t, 'settings.members.transferFailed')}
          </div>
        )}
        <div className="set-row end">
          <button type="button" className="btn" onClick={onClose}>
            {t('settings.security.cancel')}
          </button>
          <button className="btn danger" disabled={!ready || transfer.isPending}>
            {t('settings.members.transferConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

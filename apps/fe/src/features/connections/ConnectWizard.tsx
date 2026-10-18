import type { Connection, ReplyMode, Room } from '@repo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ChannelLogo } from '../../components/ChannelLogo';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useT, type MessageKey } from '../../i18n';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useUi } from '../../stores/ui';
import { inboxThreadId } from '../chat/chat.logic';
import { usePeople } from '../workspace/workspace.api';
import { useConnectionActions, useConnections } from './connections.api';
import { canOpenWizard, isSimulated } from './connections.logic';

/** Mock OAuth → choose account → route into a room with an agent. */
export function ConnectWizard() {
  const id = useUi((s) => s.wizard);
  const setWizard = useUi((s) => s.setWizard);
  const c = useConnections().find((x) => x.id === id);
  if (!c || !canOpenWizard(c)) return null;
  return <Wizard key={c.id} c={c} onClose={() => setWizard(null)} />;
}

const STEP_KEYS: MessageKey[] = [
  'connections.wizard.steps.authorize',
  'connections.wizard.steps.account',
  'connections.wizard.steps.routing',
];

function Wizard({ c, onClose }: { c: Connection; onClose: () => void }) {
  const t = useT();
  const people = usePeople();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const actions = useConnectionActions();
  const on = c.status === 'on';
  const agents = people.agents.filter((a) => a.status !== 'offline');
  const [step, setStep] = useState(on ? 3 : 1);
  const [account, setAccount] = useState(
    Math.max(
      0,
      c.accounts.findIndex((a) => a.name === c.account),
    ),
  );
  const [roomName, setRoomName] = useState(c.roomName);
  const [agentId, setAgentId] = useState(c.agentId ?? agents[0]?.id ?? '');
  const [mode, setMode] = useState<ReplyMode>(c.mode);

  const authorize = () => actions.authorize.mutate(c.id, { onSuccess: () => setStep(2) });
  const finish = () =>
    actions.connect.mutate(
      { id: c.id, account: c.accounts[account].name, roomName, agentId, mode },
      {
        onSuccess: () => {
          onClose();
          if (on) return;
          // The inbox thread id is server-generated: look it up in a fresh room list.
          void qc
            .fetchQuery({
              queryKey: qk.rooms,
              queryFn: () => api.get<Room[]>('/rooms'),
              staleTime: 0,
            })
            .then((rooms) => {
              const chatId = inboxThreadId(rooms, c.id);
              if (chatId) void navigate({ to: '/chat/$roomId', params: { roomId: chatId } });
            })
            .catch(() => undefined);
        },
      },
    );

  return (
    <Modal onClose={onClose} label={t('connections.wizard.label', { name: c.name })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ChannelLogo id={c.id} size={38} />
        <div>
          <h3 style={{ margin: 0 }}>
            {on ? t('connections.configure') : t('connections.connect')} {c.name}
          </h3>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {t('connections.wizard.stepLabel', { n: step, name: t(STEP_KEYS[step - 1]) })}
          </div>
        </div>
        <button
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
          aria-label={t('connections.close')}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="wz-steps">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= step ? 'done' : ''} />
        ))}
      </div>
      {isSimulated(c) && (
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 12px' }}>
          {t('connections.demoNote')}
        </p>
      )}

      {step === 1 && (
        <>
          <p>{t('connections.wizard.authorizeLead', { name: c.shortName })}</p>
          {c.permissions.map((p) => (
            <div key={p} className="perm">
              <span style={{ color: 'var(--ok)', display: 'flex' }}>
                <Icon name="shield" size={16} />
              </span>
              {p}
            </div>
          ))}
          <div className="wz-foot">
            <button className="btn" onClick={onClose}>
              {t('connections.cancel')}
            </button>
            <button
              className="btn primary"
              onClick={authorize}
              disabled={actions.authorize.isPending}
            >
              {actions.authorize.isPending ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      width: 14,
                      height: 14,
                      borderColor: 'rgba(255,255,255,.35)',
                      borderTopColor: '#fff',
                    }}
                  />{' '}
                  {t('connections.wizard.waitingBrowser')}
                </>
              ) : (
                t('connections.wizard.signIn', { name: c.shortName })
              )}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p>{t('connections.wizard.pickAccount', { label: c.accountLabel })}</p>
          {c.accounts.map((a, i) => (
            <div
              key={a.name}
              className={`opt-row ${i === account ? 'sel' : ''}`}
              role="radio"
              aria-checked={i === account}
              tabIndex={0}
              onClick={() => setAccount(i)}
            >
              <ChannelLogo id={c.id} size={30} />
              <div>
                <b>{a.name}</b>
                <div className="sub">{a.detail}</div>
              </div>
            </div>
          ))}
          <div className="wz-foot">
            <button className="btn" onClick={() => setStep(1)}>
              {t('connections.wizard.back')}
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              {t('connections.wizard.next')}
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <label htmlFor="wz-room">{t('connections.inboxRoom')}</label>
          <input
            id="wz-room"
            className="field"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
          />
          <label htmlFor="wz-agent" style={{ marginTop: 14 }}>
            {t('connections.agent')}
          </label>
          <select
            id="wz-agent"
            className="field"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label style={{ marginTop: 14 }}>{t('connections.replyMode')}</label>
          <div
            className={`opt-row ${mode === 'draft' ? 'sel' : ''}`}
            role="radio"
            aria-checked={mode === 'draft'}
            tabIndex={0}
            onClick={() => setMode('draft')}
          >
            <span style={{ display: 'flex', color: 'var(--olive)' }}>
              <Icon name="shield" />
            </span>
            <div>
              <b>{t('connections.mode.draft')}</b>
              <div className="sub">{t('connections.mode.draftSub')}</div>
            </div>
          </div>
          <div
            className={`opt-row ${mode === 'auto' ? 'sel' : ''}`}
            role="radio"
            aria-checked={mode === 'auto'}
            tabIndex={0}
            onClick={() => setMode('auto')}
          >
            <span style={{ display: 'flex', color: 'var(--claude)' }}>
              <Icon name="zap" />
            </span>
            <div>
              <b>{t('connections.mode.auto')}</b>
              <div className="sub">{t('connections.mode.autoSub')}</div>
            </div>
          </div>
          <div className="wz-foot">
            {on ? (
              <button className="btn" onClick={onClose}>
                {t('connections.cancel')}
              </button>
            ) : (
              <button className="btn" onClick={() => setStep(2)}>
                {t('connections.wizard.back')}
              </button>
            )}
            <button
              className="btn primary"
              onClick={finish}
              disabled={actions.connect.isPending || !agentId}
            >
              {on ? t('connections.save') : t('connections.wizard.finish')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

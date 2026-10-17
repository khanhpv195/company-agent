import type { Computer } from '@repo/shared';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { useUi } from '../../stores/ui';
import { useAgents, useComputers } from '../workspace/workspace.api';
import { useRevokeComputer } from './computers.api';
import { revokeOptions, type RevokeChoice } from './computers.logic';

/** In-app confirm before a computer (real or demo) is removed from the workspace. */
export function RevokeComputerModal({
  computer,
  onClose,
}: {
  computer: Computer;
  onClose: () => void;
}) {
  const t = useT();
  const revoke = useRevokeComputer();
  const showToast = useUi((s) => s.showToast);
  const computers = useComputers();
  const agentCount = useAgents().filter((a) => a.computerId === computer.id).length;
  // A revoked computer can only have its leftover agents moved (the same DELETE, idempotent).
  const moveOnly = Boolean(computer.revokedAt);
  const base = revokeOptions(computer, agentCount, computers);
  const options = moveOnly
    ? { ...base, choices: base.choices.filter((c) => c === 'move'), defaultChoice: 'move' as const }
    : base;
  const [choice, setChoice] = useState<RevokeChoice>(options.defaultChoice);
  const [target, setTarget] = useState(options.defaultTarget);
  const moving = choice === 'move' && options.choices.includes('move');
  const demo = computer.simulated;
  return (
    <Modal onClose={onClose} label={t('computers.remove')}>
      <h3>
        {moveOnly
          ? t('computers.moveAgentsTitle', { name: computer.name })
          : t(demo ? 'computers.revokeTitleDemo' : 'computers.revokeTitle', {
              name: computer.name,
            })}
      </h3>
      <p>
        {moveOnly
          ? t('computers.moveAgentsBody')
          : t(demo ? 'computers.revokeBodyDemo' : 'computers.revokeBody')}
      </p>
      {options.choices.length > 0 && (
        <div className="revoke-agents" role="radiogroup">
          {options.choices.map((c) => (
            <label key={c} style={{ display: 'block', margin: '8px 0' }}>
              <input
                type="radio"
                name="revoke-agents"
                checked={choice === c}
                onChange={() => setChoice(c)}
              />{' '}
              {c === 'move'
                ? t('computers.revokeMove', { count: agentCount })
                : t(c === 'delete' ? 'computers.revokeDelete' : 'computers.revokeKeep')}
              {c === 'move' && (
                <select
                  value={target}
                  aria-label={t('computers.revokeTarget')}
                  disabled={choice !== 'move'}
                  onChange={(e) => setTarget(e.target.value)}
                  style={{ marginLeft: 8 }}
                >
                  {options.targets.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.name}
                      {pc.simulated ? ` (${t('computers.demoTag')})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
        </div>
      )}
      {revoke.error && <div className="err-line">{revoke.error.message}</div>}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('computers.cancel')}
        </button>
        <button
          className="btn primary"
          style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={revoke.isPending || (moving && !target) || (moveOnly && !moving)}
          onClick={() =>
            revoke.mutate(
              { computerId: computer.id, moveAgentsTo: moving ? target : undefined },
              {
                onSuccess: () => {
                  showToast({
                    text: t('computers.revoked', { name: computer.name }),
                    agentId: null,
                    taskId: null,
                  });
                  onClose();
                },
              },
            )
          }
        >
          {moveOnly
            ? t('computers.moveAgents')
            : t(demo ? 'computers.removeDemo' : 'computers.remove')}
        </button>
      </div>
    </Modal>
  );
}

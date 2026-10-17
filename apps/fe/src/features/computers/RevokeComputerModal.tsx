import type { Computer } from '@repo/shared';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { useUi } from '../../stores/ui';
import { useRevokeComputer } from './computers.api';

/** In-app confirm before a computer is removed from the workspace. */
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
  return (
    <Modal onClose={onClose} label={t('computers.remove')}>
      <h3>{t('computers.revokeTitle', { name: computer.name })}</h3>
      <p>{t('computers.revokeBody')}</p>
      {revoke.error && <div className="err-line">{revoke.error.message}</div>}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('computers.cancel')}
        </button>
        <button
          className="btn primary"
          style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={revoke.isPending}
          onClick={() =>
            revoke.mutate(computer.id, {
              onSuccess: () => {
                showToast({
                  text: t('computers.revoked', { name: computer.name }),
                  agentId: null,
                  taskId: null,
                });
                onClose();
              },
            })
          }
        >
          {t('computers.remove')}
        </button>
      </div>
    </Modal>
  );
}

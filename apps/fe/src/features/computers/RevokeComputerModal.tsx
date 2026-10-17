import type { Computer } from '@repo/shared';
import { Modal } from '../../components/Modal';
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
  const revoke = useRevokeComputer();
  const showToast = useUi((s) => s.showToast);
  return (
    <Modal onClose={onClose} label="Gỡ máy">
      <h3>Gỡ {computer.name}?</h3>
      <p>
        Máy sẽ bị ngắt khỏi workspace và các run đang chạy trên máy này bị huỷ. Agent trên máy vẫn
        còn nhưng không chạy được cho đến khi máy được kết nối lại.
      </p>
      {revoke.error && <div className="err-line">{revoke.error.message}</div>}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          Huỷ
        </button>
        <button
          className="btn primary"
          style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={revoke.isPending}
          onClick={() =>
            revoke.mutate(computer.id, {
              onSuccess: () => {
                showToast({ text: `Đã gỡ **${computer.name}**`, agentId: null, taskId: null });
                onClose();
              },
            })
          }
        >
          Gỡ máy
        </button>
      </div>
    </Modal>
  );
}

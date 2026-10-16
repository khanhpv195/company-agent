import { Modal } from '../../components/Modal';
import { useUi } from '../../stores/ui';
import { useSession } from '../workspace/workspace.api';
import { CopyCommand } from './CopyCommand';

export function ConnectComputerModal() {
  const open = useUi((s) => s.connectComputerOpen);
  const setOpen = useUi((s) => s.setConnectComputerOpen);
  const slug = useSession().data?.workspace.slug ?? 'workspace';
  if (!open) return null;
  return (
    <Modal onClose={() => setOpen(false)} label="Connect a computer">
      <h3>Connect a computer</h3>
      <p>Chạy lệnh sau trên máy muốn kết nối. Máy sẽ xuất hiện trong danh sách khi CLI online.</p>
      <CopyCommand command={`npx @agent/cli connect --workspace ${slug}`} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={() => setOpen(false)}>
          Đóng
        </button>
      </div>
    </Modal>
  );
}

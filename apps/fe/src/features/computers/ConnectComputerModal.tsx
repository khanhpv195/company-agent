import { Modal } from '../../components/Modal';
import { useUi } from '../../stores/ui';
import { useComputerArrivals } from './computers.api';
import { PairingPanel } from './PairingPanel';

export function ConnectComputerModal() {
  const open = useUi((s) => s.connectComputerOpen);
  if (!open) return null;
  return <ConnectComputerDialog />;
}

/** Mounted only while open, so the computer list is polled only then. */
function ConnectComputerDialog() {
  const setOpen = useUi((s) => s.setConnectComputerOpen);
  const { arrived, rebase } = useComputerArrivals();
  return (
    <Modal onClose={() => setOpen(false)} label="Kết nối máy">
      <h3>Kết nối máy</h3>
      <p>
        Tạo mã kết nối rồi chạy lệnh trên máy muốn kết nối. Máy sẽ xuất hiện trong danh sách sau vài
        giây.
      </p>
      <PairingPanel arrived={arrived} onAgain={rebase} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={() => setOpen(false)}>
          Đóng
        </button>
      </div>
    </Modal>
  );
}

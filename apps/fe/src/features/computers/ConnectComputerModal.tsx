import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
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
  const t = useT();
  const setOpen = useUi((s) => s.setConnectComputerOpen);
  const { arrived, rebase } = useComputerArrivals();
  return (
    <Modal onClose={() => setOpen(false)} label={t('computers.connect')}>
      <h3>{t('computers.connect')}</h3>
      <p>{t('computers.connectLead')}</p>
      <PairingPanel arrived={arrived} onAgain={rebase} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={() => setOpen(false)}>
          {t('computers.close')}
        </button>
      </div>
    </Modal>
  );
}

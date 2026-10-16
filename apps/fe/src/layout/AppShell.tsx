import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Toast } from '../components/Toast';
import { ConnectComputerModal } from '../features/computers/ConnectComputerModal';
import { ConnectWizard } from '../features/connections/ConnectWizard';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { useRealtimeSync } from '../lib/use-realtime-sync';
import { useUi } from '../stores/ui';
import { CommandPalette } from './CommandPalette';
import { Rail } from './Rail';

export function AppShell() {
  useRealtimeSync();
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  return (
    <div className="app">
      <section className="screen" id="app">
        <Rail />
        <Outlet />
      </section>
      <Toast />
      <ConnectComputerModal />
      <NewTaskModal />
      <ConnectWizard />
      <CommandPalette />
    </div>
  );
}

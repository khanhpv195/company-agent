import type { TaskPriority, TaskStatus } from '@repo/shared';
import { create } from 'zustand';

export interface Toast {
  id: number;
  /** Inline markdown. */
  text: string;
  agentId: string | null;
  taskId: string | null;
  /** `error` styles the toast as a failure. */
  tone?: 'error';
  /** One extra button that navigates to an app route. */
  action?: { label: string; to: string };
}

interface UiState {
  toast: Toast | null;
  showToast: (t: Omit<Toast, 'id'>) => void;
  hideToast: () => void;

  connectComputerOpen: boolean;
  setConnectComputerOpen: (open: boolean) => void;

  /** Column the "new task" dialog opens on, or null when closed. */
  newTask: TaskStatus | null;
  openNewTask: (status?: TaskStatus) => void;
  closeNewTask: () => void;

  /** The "new agent" dialog: closed (null) or open, optionally with a computer preselected. */
  newAgent: { computerId: string | null } | null;
  openNewAgent: (computerId?: string) => void;
  closeNewAgent: () => void;

  /** Connection the connect wizard is open for. */
  wizard: string | null;
  setWizard: (id: string | null) => void;

  taskFilters: { q: string; who: string | null; prio: TaskPriority | '' };
  setTaskFilters: (patch: Partial<UiState['taskFilters']>) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  closedSections: string[];
  toggleSection: (id: string) => void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set) => ({
  toast: null,
  showToast: (t) => {
    clearTimeout(toastTimer);
    set({ toast: { ...t, id: ++toastSeq } });
    toastTimer = setTimeout(() => set({ toast: null }), 4200);
  },
  hideToast: () => set({ toast: null }),

  connectComputerOpen: false,
  setConnectComputerOpen: (connectComputerOpen) => set({ connectComputerOpen }),

  newTask: null,
  openNewTask: (status = 'todo') => set({ newTask: status }),
  closeNewTask: () => set({ newTask: null }),

  newAgent: null,
  openNewAgent: (computerId) => set({ newAgent: { computerId: computerId ?? null } }),
  closeNewAgent: () => set({ newAgent: null }),

  wizard: null,
  setWizard: (wizard) => set({ wizard }),

  taskFilters: { q: '', who: null, prio: '' },
  setTaskFilters: (patch) => set((s) => ({ taskFilters: { ...s.taskFilters, ...patch } })),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  closedSections: [],
  toggleSection: (id) =>
    set((s) => ({
      closedSections: s.closedSections.includes(id)
        ? s.closedSections.filter((x) => x !== id)
        : [...s.closedSections, id],
    })),
}));

import { create } from "zustand";
import { cycleWorkspaceIndex, type WorkspaceSwitcherVisit } from "@/workspace-switcher/model";

export type WorkspaceSwitcherCandidate = WorkspaceSwitcherVisit & {
  title: string;
  status: string | null;
  requiresAttention: boolean;
  iconDataUri: string | null;
  projectInitial: string;
  projectViewKey: string;
};

interface WorkspaceSwitcherStoreState {
  open: boolean;
  visible: boolean;
  selectedIndex: number;
  candidates: readonly WorkspaceSwitcherCandidate[];
  setCandidates: (candidates: readonly WorkspaceSwitcherCandidate[]) => void;
  cycle: (delta: number) => boolean;
  select: (index: number) => void;
  reveal: () => void;
  close: () => void;
}

export const useWorkspaceSwitcherStore = create<WorkspaceSwitcherStoreState>()((set, get) => ({
  open: false,
  visible: false,
  selectedIndex: 0,
  candidates: [],
  setCandidates: (candidates) => {
    if (!get().open) set({ candidates });
  },
  cycle: (delta) => {
    const state = get();
    if (state.candidates.length < 2) return false;
    set({
      open: true,
      visible: state.open ? true : state.visible,
      selectedIndex: cycleWorkspaceIndex(
        state.open ? state.selectedIndex : 0,
        delta,
        state.candidates.length,
      ),
    });
    return true;
  },
  select: (index) => {
    if (index < 0 || index >= get().candidates.length) return;
    set({ selectedIndex: index });
  },
  reveal: () => {
    if (get().open && !get().visible) set({ visible: true });
  },
  close: () => {
    if (get().open) set({ open: false, visible: false, selectedIndex: 0 });
  },
}));

export function getSelectedWorkspaceSwitcherCandidate(): WorkspaceSwitcherCandidate | null {
  const { candidates, selectedIndex } = useWorkspaceSwitcherStore.getState();
  return candidates[selectedIndex] ?? null;
}

import { create } from "zustand";
import {
  cycleWorkspaceIndex,
  initialWorkspaceSelectionIndex,
  pruneWorkspaceRows,
  workspaceVisitKey,
  type WorkspaceSwitcherVisit,
} from "@/workspace-switcher/model";

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
  /** Frozen while open, except that rows whose workspace has vanished are dropped. */
  candidates: readonly WorkspaceSwitcherCandidate[];
  /** The workspace the user is on, or null off a workspace route. Row 0 is it when it is listed. */
  currentKey: string | null;
  /** Every workspace that exists right now, kept fresh even while open. */
  liveKeys: ReadonlySet<string>;
  setCandidates: (
    candidates: readonly WorkspaceSwitcherCandidate[],
    currentKey: string | null,
    liveKeys: ReadonlySet<string>,
  ) => void;
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
  currentKey: null,
  liveKeys: new Set(),
  setCandidates: (candidates, currentKey, liveKeys) => {
    const state = get();
    if (!state.open) {
      set({ candidates, currentKey, liveKeys });
      return;
    }
    const kept = pruneWorkspaceRows(state.candidates, liveKeys);
    if (kept === state.candidates) {
      set({ liveKeys });
      return;
    }
    set({
      liveKeys,
      candidates: kept,
      selectedIndex: Math.min(state.selectedIndex, Math.max(kept.length - 1, 0)),
    });
  },
  cycle: (delta) => {
    const state = get();
    const length = state.candidates.length;
    if (state.open) {
      if (length === 0) {
        return false;
      }
      set({
        visible: true,
        selectedIndex: cycleWorkspaceIndex(state.selectedIndex, delta, length),
      });
      return true;
    }
    const start = initialWorkspaceSelectionIndex({
      length,
      rowZeroIsCurrent:
        state.currentKey !== null &&
        length > 0 &&
        workspaceVisitKey(state.candidates[0]) === state.currentKey,
    });
    if (start === null) {
      return false;
    }
    set({
      open: true,
      selectedIndex: cycleWorkspaceIndex(start, delta - 1, length),
    });
    return true;
  },
  select: (index) => {
    if (index < 0 || index >= get().candidates.length) {
      return;
    }
    set({ selectedIndex: index });
  },
  reveal: () => {
    if (get().open && !get().visible) {
      set({ visible: true });
    }
  },
  close: () => {
    if (get().open) {
      set({ open: false, visible: false, selectedIndex: 0 });
    }
  },
}));

export function getSelectedWorkspaceSwitcherCandidate(): WorkspaceSwitcherCandidate | null {
  const { candidates, selectedIndex } = useWorkspaceSwitcherStore.getState();
  return candidates[selectedIndex] ?? null;
}

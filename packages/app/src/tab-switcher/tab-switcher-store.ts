import { create } from "zustand";
import { cycleIndex, type TabSwitcherVisit } from "@/tab-switcher/model";

/** One row in the switcher: a visited chat, resolved against live agent data. */
export interface TabSwitcherCandidate extends TabSwitcherVisit {
  title: string;
  subtitle: string;
  status: string | null;
  requiresAttention: boolean;
}

interface TabSwitcherStoreState {
  open: boolean;
  selectedIndex: number;
  /**
   * Frozen while the switcher is open. Reordering the list under the user's
   * fingers is what makes a naive MRU switcher unusable, so the host only
   * refreshes candidates while `open` is false.
   */
  candidates: readonly TabSwitcherCandidate[];
  setCandidates: (candidates: readonly TabSwitcherCandidate[]) => void;
  /** Open (or advance) the switcher. Returns false when there is nothing to switch to. */
  cycle: (delta: number) => boolean;
  select: (index: number) => void;
  close: () => void;
}

export const useTabSwitcherStore = create<TabSwitcherStoreState>()((set, get) => ({
  open: false,
  selectedIndex: 0,
  candidates: [],
  setCandidates: (candidates) => {
    if (get().open) {
      return;
    }
    set({ candidates });
  },
  cycle: (delta) => {
    const state = get();
    const length = state.candidates.length;
    // Index 0 is the tab you are already on, so a single press must land on 1.
    if (length < 2) {
      return false;
    }
    set({
      open: true,
      selectedIndex: cycleIndex(state.open ? state.selectedIndex : 0, delta, length),
    });
    return true;
  },
  select: (index) => {
    const { candidates } = get();
    if (index < 0 || index >= candidates.length) {
      return;
    }
    set({ selectedIndex: index });
  },
  close: () => {
    if (!get().open) {
      return;
    }
    set({ open: false, selectedIndex: 0 });
  },
}));

export function getSelectedTabSwitcherCandidate(): TabSwitcherCandidate | null {
  const { candidates, selectedIndex } = useTabSwitcherStore.getState();
  return candidates[selectedIndex] ?? null;
}

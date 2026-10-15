import { create } from "zustand";

/** Adds the key at the end (check order) when absent, removes it when present. */
export function toggleSelectionKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((existing) => existing !== key) : [...keys, key];
}

/** Keeps only keys still on the Desk, in check order. Returns the same array when nothing left. */
export function pruneSelectionKeys(keys: readonly string[], valid: ReadonlySet<string>): string[] {
  return keys.filter((key) => valid.has(key));
}

interface DeskSelectionState {
  /** Selection mode: rows show checkboxes and a row press toggles instead of navigating. */
  active: boolean;
  /** Workspace keys, in the order they were checked (the order of the view's panes). */
  checked: string[];
  enter: () => void;
  exit: () => void;
  toggleMode: () => void;
  /** Toggles one row and enters selection mode (Cmd+click starts it). */
  toggle: (workspaceKey: string) => void;
  prune: (valid: ReadonlySet<string>) => void;
}

/** Session-only on purpose: a selection is a moment, not a setting. Never persisted. */
export const useDeskSelectionStore = create<DeskSelectionState>()((set) => ({
  active: false,
  checked: [],
  enter: () => set({ active: true }),
  exit: () => set({ active: false, checked: [] }),
  toggleMode: () =>
    set((state) => (state.active ? { active: false, checked: [] } : { active: true })),
  toggle: (workspaceKey) =>
    set((state) => ({ active: true, checked: toggleSelectionKey(state.checked, workspaceKey) })),
  prune: (valid) =>
    set((state) => {
      const next = pruneSelectionKeys(state.checked, valid);
      return next.length === state.checked.length ? state : { checked: next };
    }),
}));

let metaTrackerInstalled = false;
let metaHeldOnLastPointer = false;

/**
 * Whether Cmd was held for the most recent pointer press (web). A row press handler only sees
 * "pressed", so the Desk records the modifier at pointer-down, which always precedes the press.
 */
export function wasMetaHeldOnLastPointerDown(): boolean {
  if (!metaTrackerInstalled && typeof window !== "undefined") {
    metaTrackerInstalled = true;
    window.addEventListener(
      "pointerdown",
      (event) => {
        metaHeldOnLastPointer = event.metaKey;
      },
      true,
    );
  }
  return metaHeldOnLastPointer;
}

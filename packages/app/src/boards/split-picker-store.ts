import { create } from "zustand";

/**
 * Whether the "Split workspaces" picker is open. One store so the key, the Arrange menu and the
 * Command Center all open the same dialog; the dialog itself is mounted once (BoardsHost).
 */
interface SplitPickerStoreState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSplitPickerStore = create<SplitPickerStoreState>()((set, get) => ({
  open: false,
  setOpen: (open) => {
    if (get().open !== open) {
      set({ open });
    }
  },
}));

export function openSplitPicker(): void {
  useSplitPickerStore.getState().setOpen(true);
}

export function closeSplitPicker(): void {
  useSplitPickerStore.getState().setOpen(false);
}

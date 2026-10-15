import { create } from "zustand";

/**
 * Whether the workspace picker is open, and in which mode. One store so the key, the Arrange
 * menu, the Command Center and a view's "+ Add workspace" button all open the same dialog; the
 * dialog itself is mounted once (BoardsHost). `addToBoardId` set = "add" mode: pick workspaces
 * to add to that existing view instead of splitting a new one.
 */
interface SplitPickerStoreState {
  open: boolean;
  addToBoardId: string | null;
  setOpen: (open: boolean) => void;
  openToAdd: (boardId: string) => void;
}

export const useSplitPickerStore = create<SplitPickerStoreState>()((set, get) => ({
  open: false,
  addToBoardId: null,
  setOpen: (open) => {
    // Every plain open or close leaves add mode; only openToAdd enters it.
    if (get().open !== open || get().addToBoardId !== null) {
      set({ open, addToBoardId: null });
    }
  },
  openToAdd: (boardId) => set({ open: true, addToBoardId: boardId }),
}));

export function openSplitPicker(): void {
  useSplitPickerStore.getState().setOpen(true);
}

export function openAddWorkspacePicker(boardId: string): void {
  useSplitPickerStore.getState().openToAdd(boardId);
}

export function closeSplitPicker(): void {
  useSplitPickerStore.getState().setOpen(false);
}

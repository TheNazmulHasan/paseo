import { create } from "zustand";
import type { FolderItemRef } from "@/folders/model";

/**
 * Which item the folder picker is open for. One store so the key, a row's folder icon and the row
 * menus open the same dialog; the dialog itself is mounted once (`FolderPickerHost`).
 */
interface FolderPickerStoreState {
  target: FolderItemRef | null;
  /** Bumped on every open so the search box starts empty each time. */
  openCount: number;
  open: (target: FolderItemRef) => void;
  close: () => void;
}

export const useFolderPickerStore = create<FolderPickerStoreState>()((set) => ({
  target: null,
  openCount: 0,
  open: (target) => set((state) => ({ target, openCount: state.openCount + 1 })),
  close: () => set({ target: null }),
}));

export function openFolderPicker(target: FolderItemRef): void {
  useFolderPickerStore.getState().open(target);
}

export function closeFolderPicker(): void {
  useFolderPickerStore.getState().close();
}

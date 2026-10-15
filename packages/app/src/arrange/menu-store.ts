import { create } from "zustand";

interface ArrangeMenuStoreState {
  /** Per workspace key, so Ctrl+Cmd+L opens the menu of the workspace you are looking at. */
  openByWorkspace: Record<string, boolean>;
  setOpen: (workspaceKey: string, open: boolean) => void;
}

export const useArrangeMenuStore = create<ArrangeMenuStoreState>()((set, get) => ({
  openByWorkspace: {},
  setOpen: (workspaceKey, open) => {
    if ((get().openByWorkspace[workspaceKey] ?? false) === open) {
      return;
    }
    set({ openByWorkspace: { ...get().openByWorkspace, [workspaceKey]: open } });
  },
}));

export function openArrangeMenu(workspaceKey: string): void {
  useArrangeMenuStore.getState().setOpen(workspaceKey, true);
}

export function useArrangeMenuOpen(workspaceKey: string | null): boolean {
  return useArrangeMenuStore((state) =>
    workspaceKey ? (state.openByWorkspace[workspaceKey] ?? false) : false,
  );
}

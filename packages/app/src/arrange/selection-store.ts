import { create } from "zustand";
import type { ArrangeSelection } from "@/arrange/types";

const EMPTY_SELECTION: ArrangeSelection = { tabIds: [], agentIds: [] };

interface ArrangeSelectionStoreState {
  /** Per workspace key. Session-only on purpose: a selection is a gesture, not a setting. */
  byWorkspace: Record<string, ArrangeSelection>;
  toggleTab: (workspaceKey: string, tabId: string) => void;
  /** Shift-click: select every tab from the last toggled one to `toTabId`, in strip order. */
  selectTabRange: (workspaceKey: string, orderedTabIds: readonly string[], toTabId: string) => void;
  toggleAgent: (workspaceKey: string, agentId: string) => void;
  clear: (workspaceKey: string) => void;
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export const useArrangeSelectionStore = create<ArrangeSelectionStoreState>()((set, get) => ({
  byWorkspace: {},
  toggleTab: (workspaceKey, tabId) => {
    const current = get().byWorkspace[workspaceKey] ?? EMPTY_SELECTION;
    set({
      byWorkspace: {
        ...get().byWorkspace,
        [workspaceKey]: { ...current, tabIds: toggled(current.tabIds, tabId) },
      },
    });
  },
  selectTabRange: (workspaceKey, orderedTabIds, toTabId) => {
    const current = get().byWorkspace[workspaceKey] ?? EMPTY_SELECTION;
    const anchor = current.tabIds[current.tabIds.length - 1];
    const from = anchor ? orderedTabIds.indexOf(anchor) : -1;
    const to = orderedTabIds.indexOf(toTabId);
    if (to < 0) {
      return;
    }
    const start = from < 0 ? to : Math.min(from, to);
    const end = from < 0 ? to : Math.max(from, to);
    const range = orderedTabIds.slice(start, end + 1);
    const tabIds = [...current.tabIds, ...range.filter((id) => !current.tabIds.includes(id))];
    set({ byWorkspace: { ...get().byWorkspace, [workspaceKey]: { ...current, tabIds } } });
  },
  toggleAgent: (workspaceKey, agentId) => {
    const current = get().byWorkspace[workspaceKey] ?? EMPTY_SELECTION;
    set({
      byWorkspace: {
        ...get().byWorkspace,
        [workspaceKey]: { ...current, agentIds: toggled(current.agentIds, agentId) },
      },
    });
  },
  clear: (workspaceKey) => {
    if (!get().byWorkspace[workspaceKey]) {
      return;
    }
    const { [workspaceKey]: _cleared, ...rest } = get().byWorkspace;
    set({ byWorkspace: rest });
  },
}));

export function getArrangeSelection(workspaceKey: string): ArrangeSelection {
  return useArrangeSelectionStore.getState().byWorkspace[workspaceKey] ?? EMPTY_SELECTION;
}

export function useArrangeSelection(workspaceKey: string | null): ArrangeSelection {
  return useArrangeSelectionStore((state) =>
    workspaceKey ? (state.byWorkspace[workspaceKey] ?? EMPTY_SELECTION) : EMPTY_SELECTION,
  );
}

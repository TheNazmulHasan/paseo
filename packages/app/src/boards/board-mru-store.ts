import { create } from "zustand";
import { recordBoardTabUse } from "@/boards/screen-helpers";

/**
 * Most recently used tabs per board pane, newest first. Session-only on purpose: it feeds the
 * recent-tabs switcher while a board is on screen, and a restart should not remember it.
 */
interface BoardMruStoreState {
  byPane: Record<string, readonly string[]>;
  record: (boardId: string, paneId: string, tabId: string) => void;
}

export function boardMruKey(boardId: string, paneId: string): string {
  return `${boardId}:${paneId}`;
}

const EMPTY_MRU: readonly string[] = [];

export const useBoardMruStore = create<BoardMruStoreState>()((set, get) => ({
  byPane: {},
  record: (boardId, paneId, tabId) => {
    const key = boardMruKey(boardId, paneId);
    const current = get().byPane[key] ?? EMPTY_MRU;
    const next = recordBoardTabUse(current, tabId);
    if (next === current) {
      return;
    }
    set({ byPane: { ...get().byPane, [key]: next } });
  },
}));

export function useBoardPaneMru(boardId: string, paneId: string | null): readonly string[] {
  return useBoardMruStore((state) =>
    paneId ? (state.byPane[boardMruKey(boardId, paneId)] ?? EMPTY_MRU) : EMPTY_MRU,
  );
}

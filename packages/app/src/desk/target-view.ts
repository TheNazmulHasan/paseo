import { useMemo } from "react";
import { useBoards } from "@/boards/controller";
import type { BoardSummary } from "@/boards/types";
import { useWorkspaceSwitcherMruStore } from "@/workspace-switcher/mru-store";
import { BOARD_ROW_SERVER_ID, type WorkspaceSwitcherVisit } from "@/workspace-switcher/model";

/**
 * The view Desk → Add / Replace fills: the saved view shown last (the one on screen, else the
 * last one visited). The Live view never counts, it shows running agents, not chosen workspaces.
 */
export function resolveDeskTargetView(
  history: readonly Pick<WorkspaceSwitcherVisit, "serverId" | "workspaceId">[],
  boards: readonly BoardSummary[],
): BoardSummary | null {
  const userViews = new Map(
    boards.filter((board) => board.kind === "user").map((board) => [board.id, board]),
  );
  for (const visit of history) {
    if (visit.serverId !== BOARD_ROW_SERVER_ID) continue;
    const view = userViews.get(visit.workspaceId);
    if (view) return view;
  }
  return null;
}

export function useDeskTargetView(): BoardSummary | null {
  const history = useWorkspaceSwitcherMruStore((state) => state.history);
  const boards = useBoards();
  return useMemo(() => resolveDeskTargetView(history, boards), [boards, history]);
}

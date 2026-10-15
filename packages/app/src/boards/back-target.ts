/**
 * Where "Back to workspace" goes from a view (fork mod #13). Pure: the route the user was on
 * before opening the view wins; failing that, the workspace the view's focused pane shows.
 */
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { findBoardPane, resolvePaneActiveTabId } from "@/boards/screen-helpers";
import type { Board } from "@/boards/types";

export type BoardBackTarget =
  | { kind: "route"; pathname: string }
  | { kind: "workspace"; serverId: string; workspaceId: string };

/** The workspace of the focused pane's active tab: what "go back" falls back to. */
export function resolveBoardFocusedWorkspace(
  board: Board,
): { serverId: string; workspaceId: string } | null {
  const pane = findBoardPane(board.layout.root, board.layout.focusedPaneId);
  const origin = board.origins[resolvePaneActiveTabId(pane) ?? ""];
  return origin ? { serverId: origin.serverId, workspaceId: origin.workspaceId } : null;
}

export function resolveBoardBackTarget(input: {
  previousPathname: string | null;
  focusedWorkspace: { serverId: string; workspaceId: string } | null;
}): BoardBackTarget | null {
  const { previousPathname, focusedWorkspace } = input;
  if (previousPathname && parseBoardIdFromPathname(previousPathname) === null) {
    return { kind: "route", pathname: previousPathname };
  }
  return focusedWorkspace ? { kind: "workspace", ...focusedWorkspace } : null;
}

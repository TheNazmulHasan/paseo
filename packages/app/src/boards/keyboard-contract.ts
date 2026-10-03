/**
 * Shared between the board screen (registers handlers) and the keyboard router (routes keys
 * to them while a board is on screen). Workspace-scoped action ids listed here also work on
 * a board route; everything else stays workspace-only.
 */
export const BOARD_ROUTED_ACTION_IDS = [
  "workspace.arrange.single",
  "workspace.arrange.columns2",
  "workspace.arrange.columns3",
  "workspace.arrange.grid",
  "workspace.arrange.watch",
  "workspace.arrange.restore",
  "workspace.arrange.equalize",
  "workspace.pane.focus.left",
  "workspace.pane.focus.right",
  "workspace.pane.focus.up",
  "workspace.pane.focus.down",
  "workspace.tab.close.current",
  // Next/previous and nth tab act inside the focused pane (one workspace in a split view).
  "workspace.tab.navigate.relative",
  "workspace.tab.navigate.index",
  // "New agent" (Cmd+Shift+A, often rebound) opens a draft in the focused pane's workspace.
  "workspace.tab.target.agent",
] as const;

export type BoardRoutedActionId = (typeof BOARD_ROUTED_ACTION_IDS)[number];

/** Handler id the board screen registers with useKeyboardActionHandler. */
export function boardKeyboardHandlerId(boardId: string): string {
  return `board-actions:${boardId}`;
}

/** `/boards/<id>` → id, else null. */
export function parseBoardIdFromPathname(pathname: string | null | undefined): string | null {
  const match = /^\/boards\/([^/?#]+)/.exec(pathname ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

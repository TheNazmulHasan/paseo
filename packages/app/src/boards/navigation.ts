import { router, type Href } from "expo-router";
import { getPreviousNonBoardPathname } from "@/boards/back-store";
import { resolveBoardBackTarget, resolveBoardFocusedWorkspace } from "@/boards/back-target";
import { getBoard } from "@/boards/controller";
import { buildBoardRoute } from "@/boards/screen-helpers";
import { isInteractionNavigationAllowed } from "@/interaction-lock/actions";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

/** Opens a view (`/boards/<id>`). Same hop as a workspace: dismissTo, so repeats do not stack. */
export function navigateToBoard(boardId: string): void {
  if (!isInteractionNavigationAllowed()) {
    return;
  }
  router.dismissTo(buildBoardRoute(boardId) as Href);
}

/**
 * Leaves a view for the normal workspace screen: the route the user was on before the view,
 * else the workspace of the focused pane. Returns false when there is nowhere to go.
 */
export function goBackFromBoard(boardId: string): boolean {
  const board = getBoard(boardId);
  const target = resolveBoardBackTarget({
    previousPathname: getPreviousNonBoardPathname(),
    focusedWorkspace: board ? resolveBoardFocusedWorkspace(board) : null,
  });
  if (!target) {
    return false;
  }
  if (target.kind === "workspace") {
    navigateToWorkspace({ serverId: target.serverId, workspaceId: target.workspaceId });
    return true;
  }
  if (!isInteractionNavigationAllowed()) {
    return false;
  }
  router.dismissTo(target.pathname as Href);
  return true;
}

import { router, type Href } from "expo-router";
import { buildBoardRoute } from "@/boards/screen-helpers";
import { isInteractionNavigationAllowed } from "@/interaction-lock/actions";

/** Opens a view (`/boards/<id>`). Same hop as a workspace: dismissTo, so repeats do not stack. */
export function navigateToBoard(boardId: string): void {
  if (!isInteractionNavigationAllowed()) {
    return;
  }
  router.dismissTo(buildBoardRoute(boardId) as Href);
}

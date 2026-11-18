import { router } from "expo-router";
import { isInteractionNavigationAllowed } from "@/interaction-lock/actions";
import { buildHomeRoute } from "./route";

/**
 * Nazmul mod (home-map): opens Home from the Hyper+J switcher. Same hop as a workspace or a view
 * (dismissTo), so repeated jumps do not stack Home screens.
 */
export function navigateToHome(): void {
  if (!isInteractionNavigationAllowed()) {
    return;
  }
  router.dismissTo(buildHomeRoute());
}

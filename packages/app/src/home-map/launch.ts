import { useAppSettings } from "@/hooks/use-settings";

/**
 * "Open Home on launch" (fork mod, home-map): a desktop cold start lands on Home instead of
 * restoring the last workspace. Only the first start counts. Any later visit to the app's index
 * route (closing the last tab, say) restores the workspace as upstream does.
 *
 * "Landed" flips when the Home screen itself mounts, not when the redirect is decided: the index
 * route can render several times before the navigation completes, and each pass must still say Home.
 */
let landedOnHome = false;

export function hasLandedOnHome(): boolean {
  return landedOnHome;
}

export function markLandedOnHome(): void {
  landedOnHome = true;
}

/** Test seam. */
export function resetHomeLandingForTests(): void {
  landedOnHome = false;
}

export function shouldOpenHomeOnLaunch(input: {
  /** The "Open Home on launch" setting. */
  enabled: boolean;
  /** The desktop app (Electron). Phone and browser keep restoring the workspace. */
  isDesktop: boolean;
  landed: boolean;
}): boolean {
  return input.enabled && input.isDesktop && !input.landed;
}

/**
 * What the index route needs: `ready` is false until the settings have loaded (the answer is not
 * known yet, so the splash holds), then `openHome` says whether to land on Home.
 */
export function useHomeLaunchDecision(isDesktop: boolean): { ready: boolean; openHome: boolean } {
  const { settings, isLoading } = useAppSettings();
  if (!isDesktop) {
    return { ready: true, openHome: false };
  }
  return {
    ready: !isLoading,
    openHome: shouldOpenHomeOnLaunch({
      enabled: settings.openHomeOnLaunch,
      isDesktop,
      landed: hasLandedOnHome(),
    }),
  };
}

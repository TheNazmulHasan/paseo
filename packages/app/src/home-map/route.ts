import type { Href } from "expo-router";

/**
 * Home (fork mod, home-map): one global route, like /sessions and /schedules. It is not scoped to
 * a host because Home reads every connected host's sessions at once.
 */
export const HOME_ROUTE = "/home";

/**
 * Typed as `Href` on purpose: expo-router's generated route types (`.expo/types/router.d.ts`) are
 * rebuilt by `expo export`, so a route added since the last build is not in them yet.
 */
export function buildHomeRoute(): Href {
  return HOME_ROUTE as Href;
}

export function isHomePathname(pathname: string): boolean {
  return pathname === HOME_ROUTE;
}

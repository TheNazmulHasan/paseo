// Home v2 (fork mod, home-map): "Recently worked on" pages. The first rows are the open sessions
// he last wrote to (the shared `buildHomeView` gives them all, newest first); when those run out,
// closed (archived) sessions follow, served by the daemon a page at a time. Pure, so the paging
// rules are tested without a screen.
import {
  HOME_RECENT_LIMIT,
  HOME_RECENT_PAGE,
  type HomeRecentItem,
} from "@getpaseo/protocol/home";
import type { HomeSessionEntry } from "./view-model";

export { HOME_RECENT_LIMIT, HOME_RECENT_PAGE };

/** A closed session from one host's daemon. */
export interface ClosedRecent extends HomeRecentItem {
  serverId: string;
}

export type RecentRow =
  | { kind: "open"; key: string; entry: HomeSessionEntry }
  | { kind: "closed"; key: string; item: ClosedRecent };

const closedKey = (item: ClosedRecent): string => `${item.serverId}:${item.agentId}`;

/** Closed sessions newest first (by his last message), without any that are open again. */
export function closedBelowOpen(
  closed: readonly ClosedRecent[],
  openKeys: ReadonlySet<string>,
): ClosedRecent[] {
  const seen = new Set<string>();
  return closed
    .filter((item) => {
      const key = closedKey(item);
      if (openKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.lastUserMessageAt) - Date.parse(a.lastUserMessageAt));
}

/**
 * The first `visible` rows: open sessions, then closed ones. `canShowMore` is true when more rows
 * are already loaded or any daemon still has closed sessions it has not sent.
 */
export function pageRecent(input: {
  open: readonly HomeSessionEntry[];
  closed: readonly ClosedRecent[];
  visible: number;
  moreOnDaemon: boolean;
}): { rows: RecentRow[]; canShowMore: boolean } {
  const openKeys = new Set(input.open.map((entry) => entry.session.id));
  const all: RecentRow[] = [
    ...input.open.map((entry) => ({ kind: "open" as const, key: entry.session.id, entry })),
    ...closedBelowOpen(input.closed, openKeys).map((item) => ({
      kind: "closed" as const,
      key: closedKey(item),
      item,
    })),
  ];
  return {
    rows: all.slice(0, input.visible),
    canShowMore: all.length > input.visible || input.moreOnDaemon,
  };
}

/** How many closed sessions must still be fetched to fill `visible` rows. */
export function closedNeeded(input: {
  visible: number;
  openCount: number;
  closedLoaded: number;
}): number {
  return Math.max(0, input.visible - input.openCount - input.closedLoaded);
}

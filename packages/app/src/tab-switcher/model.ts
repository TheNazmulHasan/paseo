// Pure logic for the Arc-style most-recently-used (MRU) tab switcher.
//
// The switcher answers one question: "which chats did I look at last, newest
// first?" Everything stateful lives in the stores; this file stays pure so the
// ordering rules can be tested without a renderer.

export interface TabSwitcherVisit {
  serverId: string;
  agentId: string;
  /** Epoch millis of the most recent visit. Kept for debugging and pruning. */
  at: number;
}

/** How many visits are persisted. The overlay shows fewer. */
export const TAB_SWITCHER_HISTORY_LIMIT = 30;
/** How many rows the overlay lists. */
export const TAB_SWITCHER_VISIBLE_LIMIT = 10;
/** Idle gap after the last keypress before the selection commits. */
export const TAB_SWITCHER_COMMIT_DELAY_MS = 900;

export function visitKey(visit: Pick<TabSwitcherVisit, "serverId" | "agentId">): string {
  return `${visit.serverId}:${visit.agentId}`;
}

/**
 * Move `visit` to the front of `history`, dropping any earlier entry for the
 * same agent. Returns the same array reference when nothing would change, so
 * zustand subscribers do not re-render on a repeated visit to the same tab.
 */
export function recordVisit(
  history: readonly TabSwitcherVisit[],
  visit: TabSwitcherVisit,
  limit: number = TAB_SWITCHER_HISTORY_LIMIT,
): readonly TabSwitcherVisit[] {
  const serverId = visit.serverId.trim();
  const agentId = visit.agentId.trim();
  if (!serverId || !agentId) {
    return history;
  }
  if (history[0]?.serverId === serverId && history[0]?.agentId === agentId) {
    return history;
  }
  const key = visitKey({ serverId, agentId });
  const next: TabSwitcherVisit[] = [{ serverId, agentId, at: visit.at }];
  for (const entry of history) {
    if (visitKey(entry) === key) {
      continue;
    }
    next.push(entry);
    if (next.length >= limit) {
      break;
    }
  }
  return next;
}

/** Drop history entries whose agent no longer exists. */
export function pruneVisits(
  history: readonly TabSwitcherVisit[],
  isKnown: (visit: TabSwitcherVisit) => boolean,
): readonly TabSwitcherVisit[] {
  const kept = history.filter((visit) => isKnown(visit));
  return kept.length === history.length ? history : kept;
}

/**
 * Wrap `index` by `delta` inside a list of `length` entries.
 * Returns 0 for an empty list so callers never index out of range.
 */
export function cycleIndex(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}

/**
 * Order the switcher rows: chats you actually visited first, in visit order,
 * then a backfill of everything else the app knows about.
 *
 * The backfill is what makes the switcher work on a fresh install. Visit history
 * starts empty, so without it the list holds one entry — the chat you are in —
 * and the switcher refuses to open, which reads as "the key does nothing".
 */
export function mergeRecentOrder(
  historyKeys: readonly string[],
  fallbackKeys: readonly string[],
  limit: number = TAB_SWITCHER_VISIBLE_LIMIT,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const key of [...historyKeys, ...fallbackKeys]) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(key);
    if (ordered.length >= limit) {
      break;
    }
  }
  return ordered;
}

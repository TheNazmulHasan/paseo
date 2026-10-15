// Pure logic for the Arc-style most-recently-used (MRU) tab switcher.
//
// The switcher answers one question: "which tabs did I look at last, newest
// first?" Everything stateful lives in the stores; this file stays pure so the
// ordering rules can be tested without a renderer.
//
// A "tab" is a chat OR an open file, because that is what sits in Paseo's tab bar
// and how Nazmul actually works: agent on the left, the markdown file it is
// editing on the right, flicking between the two. Terminal and browser tabs are
// deliberately absent — see the note in tab-switcher-host.tsx.

/** Epoch millis of the most recent visit, on both variants. */
interface TabSwitcherVisitBase {
  serverId: string;
  at: number;
}

export interface TabSwitcherAgentVisit extends TabSwitcherVisitBase {
  kind: "agent";
  agentId: string;
}

export interface TabSwitcherFileVisit extends TabSwitcherVisitBase {
  kind: "file";
  /** A file tab belongs to one workspace's layout, unlike an agent. */
  workspaceId: string;
  path: string;
}

export type TabSwitcherVisit = TabSwitcherAgentVisit | TabSwitcherFileVisit;

/** How many visits are persisted. The overlay shows fewer. */
export const TAB_SWITCHER_HISTORY_LIMIT = 30;
/** How many rows the overlay lists. */
export const TAB_SWITCHER_VISIBLE_LIMIT = 10;
/**
 * Safety net only. The switcher commits when the held modifier is released
 * (Hyper, in Nazmul's setup) — that is the whole interaction. This timer exists
 * so a missed modifier keyup can never leave the overlay stuck on screen, and it
 * switches itself off for good the first time a real release is observed.
 */
export const TAB_SWITCHER_FALLBACK_COMMIT_MS = 8000;

/**
 * A tap-and-release switch is over in well under this, so the overlay never
 * paints for it. Hold the modifier past it and the list appears and stays.
 */
export const TAB_SWITCHER_REVEAL_DELAY_MS = 250;

/**
 * Karabiner suppresses Hyper's modifiers for the remapped event and restores
 * them a moment later, so right after the trigger key goes up we cannot yet tell
 * "tapped and released" from "still holding". This is how long we wait for a
 * modifier to show itself before deciding it was a tap and committing.
 */
export const TAB_SWITCHER_MODIFIER_GRACE_MS = 200;

export function visitKey(visit: TabSwitcherVisit): string {
  return visit.kind === "agent"
    ? `agent:${visit.serverId}:${visit.agentId}`
    : `file:${visit.serverId}:${visit.workspaceId}:${visit.path}`;
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
  const normalized = normalizeVisit(visit);
  if (!normalized) {
    return history;
  }
  const key = visitKey(normalized);
  if (history[0] && visitKey(history[0]) === key) {
    return history;
  }
  const next: TabSwitcherVisit[] = [normalized];
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

/** Drop a visit whose identifying fields are blank — it could never be reopened. */
function normalizeVisit(visit: TabSwitcherVisit): TabSwitcherVisit | null {
  const serverId = visit.serverId.trim();
  if (!serverId) {
    return null;
  }
  if (visit.kind === "agent") {
    const agentId = visit.agentId.trim();
    return agentId ? { kind: "agent", serverId, agentId, at: visit.at } : null;
  }
  const workspaceId = visit.workspaceId.trim();
  const path = visit.path.trim();
  return workspaceId && path ? { kind: "file", serverId, workspaceId, path, at: visit.at } : null;
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

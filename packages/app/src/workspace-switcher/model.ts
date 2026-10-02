export interface WorkspaceSwitcherVisit {
  serverId: string;
  workspaceId: string;
  at: number;
}

export const WORKSPACE_SWITCHER_HISTORY_LIMIT = 30;
export const WORKSPACE_SWITCHER_VISIBLE_LIMIT = 10;
export const WORKSPACE_SWITCHER_FALLBACK_COMMIT_MS = 8000;
export const WORKSPACE_SWITCHER_REVEAL_DELAY_MS = 250;
export const WORKSPACE_SWITCHER_MODIFIER_GRACE_MS = 200;

export function workspaceVisitKey(
  visit: Pick<WorkspaceSwitcherVisit, "serverId" | "workspaceId">,
): string {
  return `${visit.serverId}:${visit.workspaceId}`;
}

/**
 * Boards (fork mod #13) share the switcher's rows. A board row is keyed like a workspace row, under
 * a pseudo host, so freezing, pruning and selecting need no second code path.
 */
export const BOARD_ROW_SERVER_ID = "board";

export function boardRowKey(boardId: string): string {
  return `${BOARD_ROW_SERVER_ID}:${boardId}`;
}

/**
 * Puts the board rows after the head (current + the workspace just left) and the Desk workspaces
 * that follow it, ahead of everything else. Same array when there are no boards.
 */
export function insertBoardKeys(
  keys: readonly string[],
  boardKeys: readonly string[],
  deskKeys: ReadonlySet<string>,
  headCount: number,
): readonly string[] {
  if (boardKeys.length === 0) {
    return keys;
  }
  let at = Math.min(headCount, keys.length);
  while (at < keys.length && deskKeys.has(keys[at])) {
    at += 1;
  }
  return [...keys.slice(0, at), ...boardKeys, ...keys.slice(at)];
}

export function recordWorkspaceVisit(
  history: readonly WorkspaceSwitcherVisit[],
  visit: WorkspaceSwitcherVisit,
  limit: number = WORKSPACE_SWITCHER_HISTORY_LIMIT,
): readonly WorkspaceSwitcherVisit[] {
  const serverId = visit.serverId.trim();
  const workspaceId = visit.workspaceId.trim();
  if (!serverId || !workspaceId) {
    return history;
  }
  const normalized = { serverId, workspaceId, at: visit.at };
  const key = workspaceVisitKey(normalized);
  if (history[0] && workspaceVisitKey(history[0]) === key) {
    return history;
  }
  const next = [normalized];
  for (const entry of history) {
    if (workspaceVisitKey(entry) === key) {
      continue;
    }
    next.push(entry);
    if (next.length >= limit) {
      break;
    }
  }
  return next;
}

export function cycleWorkspaceIndex(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}

export function mergeWorkspaceOrder(
  historyKeys: readonly string[],
  fallbackKeys: readonly string[],
  limit: number = WORKSPACE_SWITCHER_VISIBLE_LIMIT,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of [...historyKeys, ...fallbackKeys]) {
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

/**
 * Where a tap lands. Row 0 is the workspace you are on when there is one, so a
 * tap goes to row 1; off a workspace route (settings, home) row 0 is already
 * the one you just left. Null when there is nothing else to switch to.
 */
export function initialWorkspaceSelectionIndex(input: {
  length: number;
  rowZeroIsCurrent: boolean;
}): number | null {
  const target = input.rowZeroIsCurrent ? 1 : 0;
  return target < input.length ? target : null;
}

/** Rows whose workspace is still in the live set, order kept. Same array when nothing drops. */
export function pruneWorkspaceRows<
  T extends Pick<WorkspaceSwitcherVisit, "serverId" | "workspaceId">,
>(rows: readonly T[], liveKeys: ReadonlySet<string>): readonly T[] {
  const kept = rows.filter((row) => liveKeys.has(workspaceVisitKey(row)));
  return kept.length === rows.length ? rows : kept;
}

/**
 * Drop history for archived/removed workspaces. A host with no live workspace in
 * `liveKeys` is still loading, so its history is left alone, never wiped.
 * `keepKey` (the workspace being viewed) survives even if placements lag behind.
 */
export function pruneWorkspaceHistory(
  history: readonly WorkspaceSwitcherVisit[],
  liveKeys: ReadonlySet<string>,
  keepKey: string | null = null,
): readonly WorkspaceSwitcherVisit[] {
  const loadedServers = new Set<string>();
  for (const key of liveKeys) {
    loadedServers.add(key.slice(0, key.lastIndexOf(":")));
  }
  const kept = history.filter(
    (visit) =>
      !loadedServers.has(visit.serverId) ||
      liveKeys.has(workspaceVisitKey(visit)) ||
      workspaceVisitKey(visit) === keepKey,
  );
  return kept.length === history.length ? history : kept;
}

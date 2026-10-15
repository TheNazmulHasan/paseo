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

/** A view visit, typed: the same record a workspace visit is, under the pseudo host. */
export function boardVisit(
  boardId: string,
): Pick<WorkspaceSwitcherVisit, "serverId" | "workspaceId"> {
  return { serverId: BOARD_ROW_SERVER_ID, workspaceId: boardId };
}

export function isBoardRowKey(key: string): boolean {
  return key.startsWith(`${BOARD_ROW_SERVER_ID}:`);
}

/**
 * Orders every switcher row, workspaces and views alike, by recency. A view is just another
 * place you have been, so `historyKeys` (newest first, views included) drives the order.
 * Row 0 is the current place and row 1 the one just left (the head), so a tap always lands there.
 * After the head, the Desk workspaces and the views you have visited lead, in recency order;
 * views never visited follow, then everything else (never-visited workspaces keep placement order).
 */
export function orderSwitcherKeys(input: {
  currentKey: string | null;
  historyKeys: readonly string[];
  workspaceKeys: readonly string[];
  boardKeys: readonly string[];
  deskKeys: ReadonlySet<string>;
}): readonly string[] {
  const visited = input.historyKeys.filter((key) => key !== input.currentKey);
  const seen = new Set<string>(visited);
  if (input.currentKey) {
    seen.add(input.currentKey);
  }
  const unvisitedWorkspaces = input.workspaceKeys.filter((key) => !seen.has(key));
  const unvisitedBoards = input.boardKeys.filter((key) => !seen.has(key));
  const sequence = [
    ...(input.currentKey ? [input.currentKey] : []),
    ...visited,
    ...unvisitedWorkspaces,
  ];
  const headCount = input.currentKey ? 2 : 1;
  const head = sequence.slice(0, headCount);
  const rest = sequence.slice(headCount);
  const leading = (key: string) => input.deskKeys.has(key) || isBoardRowKey(key);
  return [
    ...head,
    ...rest.filter(leading),
    ...unvisitedBoards,
    ...rest.filter((key) => !leading(key)),
  ];
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

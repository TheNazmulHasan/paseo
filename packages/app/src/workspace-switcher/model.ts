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
    if (workspaceVisitKey(entry) === key) continue;
    next.push(entry);
    if (next.length >= limit) break;
  }
  return next;
}

export function cycleWorkspaceIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
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
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= limit) break;
  }
  return result;
}

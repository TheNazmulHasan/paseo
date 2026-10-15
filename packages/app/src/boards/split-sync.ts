/**
 * Split views follow their workspaces (fork mod #13, backlog B2). A split view copies each
 * workspace's tab list once; this keeps the copy current afterwards, the way `useLiveBoardSync`
 * keeps the Live view current.
 *
 * It watches CHANGES in a workspace's tab set, never the difference between the workspace and
 * the view: a file opened inside the view, or an agent a draft just became, is on the view
 * before the workspace knows about it and must not be swept away.
 *
 * - The workspace gains a session -> it is appended to that workspace's pane and becomes the
 *   pane's active tab.
 * - The workspace loses a session -> its tab closes in the view.
 * - A tab closed in the view closes in the workspace (`closeSessionInWorkspace`, called from
 *   `removeBoardTab`).
 *
 * A workspace's tab set is its layout tabs (agents and files) plus the agents the workspace
 * screen would auto-open. The layout alone is stale while that screen is not mounted, and a
 * view is exactly when it is not.
 */
import { useEffect } from "react";
import { useBoardStore } from "@/boards/board-store";
import {
  appendSessionToWorkspacePane,
  boardSessionKey,
  removeSessionFromBoard,
} from "@/boards/model";
import type { Board, BoardSessionRef, BoardTabOrigin } from "@/boards/types";
import { useSessionStore } from "@/stores/session-store";
import { collectAllPanes, collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { deriveWorkspaceAgentVisibility } from "@/workspace-tabs/agent-visibility";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/** Store updates arrive in bursts; the first one in a burst starts the clock. */
const SYNC_THROTTLE_MS = 150;

type WorkspaceRef = Pick<BoardTabOrigin, "serverId" | "workspaceId">;

/** workspace key -> its sessions the last time we looked (by session key). */
const lastSeen = new Map<string, Map<string, BoardSessionRef>>();

function isLayoutHydrated(): boolean {
  const persist = useWorkspaceLayoutStore.persist;
  return typeof persist?.hasHydrated === "function" ? persist.hasHydrated() : true;
}

/**
 * Everything the workspace has open or would open, keyed by session key. Null while it cannot
 * be known yet (layout or agent list not loaded): a half-loaded list must not look like
 * "everything was added" or "everything was closed".
 */
function readWorkspaceSessions(ref: WorkspaceRef): Map<string, BoardSessionRef> | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey(ref);
  const session = useSessionStore.getState().sessions[ref.serverId];
  if (!workspaceKey || !session?.hasHydratedAgents || !isLayoutHydrated()) {
    return null;
  }
  const layoutState = useWorkspaceLayoutStore.getState();
  const visibility = deriveWorkspaceAgentVisibility({
    sessionAgents: session.agents,
    agentDetails: session.agentDetails,
    workspaceId: ref.workspaceId,
  });
  const pinned = layoutState.pinnedAgentIdsByWorkspace[workspaceKey];
  const hidden = layoutState.hiddenAgentIdsByWorkspace[workspaceKey];
  const found = new Map<string, BoardSessionRef>();
  const add = (entry: BoardSessionRef) => found.set(boardSessionKey(entry), entry);

  const layout = layoutState.layoutByWorkspace[workspaceKey];
  for (const tab of layout ? collectAllTabs(layout.root) : []) {
    if (tab.target.kind === "agent") {
      // Same prune rule as the workspace screen: an agent that is no longer active (archived)
      // has no tab, unless an explicit open pinned it.
      const { agentId } = tab.target;
      if (visibility.activeAgentIds.has(agentId) || pinned?.has(agentId)) {
        add({ ...ref, agentId });
      }
    } else if (tab.target.kind === "file") {
      add({ ...ref, path: tab.target.path });
    }
  }
  for (const agentId of visibility.autoOpenAgentIds) {
    if (!hidden?.has(agentId)) {
      add({ ...ref, agentId });
    }
  }
  return found;
}

/**
 * Takes a baseline for a workspace that just joined a view, so a session it gains a moment
 * later counts as new. Without it the first sync pass would only take the baseline.
 */
export function rememberWorkspaceTabs(ref: WorkspaceRef): void {
  const key = buildWorkspaceTabPersistenceKey(ref);
  const sessions = readWorkspaceSessions(ref);
  if (key && sessions) {
    lastSeen.set(key, sessions);
  }
}

function boardWorkspaces(board: Board): Map<string, WorkspaceRef> {
  const found = new Map<string, WorkspaceRef>();
  for (const origin of Object.values(board.origins)) {
    const key = buildWorkspaceTabPersistenceKey(origin);
    if (key && !found.has(key)) {
      found.set(key, { serverId: origin.serverId, workspaceId: origin.workspaceId });
    }
  }
  return found;
}

function paneCount(board: Board): number {
  return collectAllPanes(board.layout.root).length;
}

function applyChanges(
  boardId: string,
  added: readonly BoardSessionRef[],
  removed: readonly BoardSessionRef[],
): void {
  const store = useBoardStore.getState();
  const board = store.boards[boardId];
  if (!board) {
    return;
  }
  let next = board;
  for (const session of removed) {
    next = removeSessionFromBoard(next, session);
  }
  for (const session of added) {
    next = appendSessionToWorkspacePane(next, session) ?? next;
  }
  if (next === board) {
    return;
  }
  store.putBoard(next);
  if (paneCount(next) !== paneCount(board)) {
    // A pane emptied by a close is gone: reopening the CURRENT set of workspaces must find
    // this view, and the arrange preset no longer describes the layout.
    const keys = [...boardWorkspaces(next).keys()];
    store.rekeySplitPair(boardId, keys.length >= 2 ? JSON.stringify([...keys].sort()) : null);
    store.patchArrange(boardId, { lastPreset: null });
  }
}

/** One pass over every split view. Cheap and safe to run as often as you like. */
export function syncSplitBoards(): void {
  const boards = Object.values(useBoardStore.getState().boards).filter(
    (board) => board.kind === "user",
  );
  const workspaces = new Map<string, WorkspaceRef>();
  for (const board of boards) {
    for (const [key, ref] of boardWorkspaces(board)) {
      workspaces.set(key, ref);
    }
  }
  for (const key of lastSeen.keys()) {
    if (!workspaces.has(key)) {
      lastSeen.delete(key);
    }
  }

  for (const [workspaceKey, ref] of workspaces) {
    const now = readWorkspaceSessions(ref);
    if (!now) {
      continue;
    }
    const before = lastSeen.get(workspaceKey);
    lastSeen.set(workspaceKey, now);
    if (!before) {
      continue;
    }
    const added = [...now].filter(([key]) => !before.has(key)).map(([, entry]) => entry);
    const removed = [...before].filter(([key]) => !now.has(key)).map(([, entry]) => entry);
    if (added.length === 0 && removed.length === 0) {
      continue;
    }
    for (const board of boards) {
      if (boardWorkspaces(board).has(workspaceKey)) {
        applyChanges(board.id, added, removed);
      }
    }
  }
}

/**
 * Closes a session's tab in its own workspace (what closing it in a view means). Layout-level
 * only: the agent is hidden so the workspace does not auto-open it again, but it is not
 * archived. Closing a root agent's tab inside the workspace itself archives it, after a
 * confirm; a view never did, and starting to would be a surprise.
 */
export function closeSessionInWorkspace(origin: BoardTabOrigin): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(origin);
  if (!workspaceKey || (origin.agentId === undefined && origin.path === undefined)) {
    return;
  }
  const workspaceStore = useWorkspaceLayoutStore.getState();
  if (origin.agentId !== undefined) {
    workspaceStore.unpinAgent(workspaceKey, origin.agentId);
    workspaceStore.hideAgent(workspaceKey, origin.agentId);
  }
  const layout = workspaceStore.layoutByWorkspace[workspaceKey];
  const tab = layout
    ? collectAllTabs(layout.root).find((candidate) =>
        origin.agentId !== undefined
          ? candidate.target.kind === "agent" && candidate.target.agentId === origin.agentId
          : candidate.target.kind === "file" && candidate.target.path === origin.path,
      )
    : undefined;
  if (tab) {
    workspaceStore.closeTab(workspaceKey, tab.tabId);
  }
}

/** Mount once at app level: split views follow their workspaces' tabs. */
export function useSplitBoardSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        syncSplitBoards();
      }, SYNC_THROTTLE_MS);
    };
    const unsubscribers = [
      useWorkspaceLayoutStore.subscribe(schedule),
      useSessionStore.subscribe(schedule),
      useBoardStore.subscribe(schedule),
    ];
    schedule();
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);
}

/** Test seam: forget every baseline. */
export function resetSplitSyncForTests(): void {
  lastSeen.clear();
}

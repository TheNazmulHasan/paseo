/**
 * Boards controller (fork mod #13). Signatures are the contract the screen and the entry
 * points code against. Rules (what moves where) live in model.ts; this file reads the
 * stores, calls the model, and writes the result back to the board store.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ArrangePreset, ArrangeViewport } from "@/arrange/types";
import { getBoardArrangeState, useBoardStore } from "@/boards/board-store";
import {
  addSessionsToBoardModel,
  appendActiveSessions,
  arrangeBoardTabs,
  boardSessionKey,
  buildWorkspaceSplit,
  countBoardSessions,
  createEmptyBoardLayout,
  equalizeBoardLayout,
  findBoardTabId,
  focusBoardPaneModel,
  moveBoardTab,
  rebuildLiveBoard,
  removeTabFromBoard,
  resizeBoardSplitModel,
  restoreBoardLayout,
  selectBoardTabModel,
  type BoardSplitGroup,
  type BoardSplitLayout,
} from "@/boards/model";
import { LIVE_BOARD_ID, type Board, type BoardSessionRef, type BoardSummary } from "@/boards/types";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  findPaneContainingTab,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/** A burst of agents starting together should produce one re-arrange, not one each. */
const LIVE_SYNC_DEBOUNCE_MS = 300;
const DEFAULT_VIEWPORT: ArrangeViewport = { width: 1600, height: 1000 };
/** Names listed in a split board's title before the rest collapse into "+N". */
const MAX_NAMED_WORKSPACES = 3;

/** The size the Live board was last arranged for, so auto-growth matches what is on screen. */
let lastLiveViewport: ArrangeViewport | null = null;

type SessionsState = ReturnType<typeof useSessionStore.getState>["sessions"];

interface WorkspaceRef {
  serverId: string;
  workspaceId: string;
}

function boardStore() {
  return useBoardStore.getState();
}

function createBoardId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `board_${value}`;
}

function nextBoardName(): string {
  const boards = Object.values(boardStore().boards);
  const taken = new Set(boards.map((board) => board.name));
  let index = boards.filter((board) => board.kind === "user").length + 1;
  while (taken.has(`Board ${index}`)) {
    index += 1;
  }
  return `Board ${index}`;
}

function readBoard(boardId: string): Board | null {
  if (boardId === LIVE_BOARD_ID) {
    boardStore().ensureLive();
  }
  return boardStore().boards[boardId] ?? null;
}

/** Runs `update` on the board and stores the result when it changed anything. */
function updateBoard(boardId: string, update: (board: Board) => Board): void {
  const board = readBoard(boardId);
  if (!board) {
    return;
  }
  const next = update(board);
  if (next !== board) {
    boardStore().putBoard(next);
  }
}

export function createBoard(
  name: string,
  sessions: readonly BoardSessionRef[] = [],
): string | null {
  const board: Board = {
    id: createBoardId(),
    name: name.trim() || nextBoardName(),
    createdAt: Date.now(),
    kind: "user",
    layout: createEmptyBoardLayout(),
    splitSizes: {},
    origins: {},
  };
  boardStore().putBoard(addSessionsToBoardModel(board, sessions).board);
  return board.id;
}

export function renameBoard(boardId: string, name: string): void {
  const trimmed = name.trim();
  if (boardId === LIVE_BOARD_ID || !trimmed) {
    return;
  }
  updateBoard(boardId, (board) => (board.name === trimmed ? board : { ...board, name: trimmed }));
}

export function deleteBoard(boardId: string): void {
  boardStore().removeBoard(boardId);
}

/** Adds sessions (skipping ones already on the board) into the board's focused pane. */
export function addSessionsToBoard(boardId: string, sessions: readonly BoardSessionRef[]): number {
  const board = readBoard(boardId);
  if (!board) {
    return 0;
  }
  const { board: next, addedTabIds } = addSessionsToBoardModel(board, sessions);
  if (addedTabIds.length > 0) {
    boardStore().putBoard(next);
  }
  return addedTabIds.length;
}

export function removeBoardTab(boardId: string, tabId: string): void {
  updateBoard(boardId, (board) => removeTabFromBoard(board, tabId));
}

export function focusBoardPane(boardId: string, paneId: string): void {
  updateBoard(boardId, (board) => focusBoardPaneModel(board, paneId));
}

export function selectBoardTab(boardId: string, paneId: string, tabId: string): void {
  updateBoard(boardId, (board) => selectBoardTabModel(board, paneId, tabId));
}

export function moveBoardTabToPane(boardId: string, tabId: string, toPaneId: string): void {
  updateBoard(boardId, (board) => moveBoardTab(board, tabId, toPaneId));
}

export function resizeBoardSplit(boardId: string, groupId: string, sizes: number[]): void {
  updateBoard(boardId, (board) => resizeBoardSplitModel(board, groupId, sizes));
}

/** Same toggle semantics as arrangeWorkspace: same preset twice restores. */
export function arrangeBoard(input: {
  boardId: string;
  preset: ArrangePreset;
  viewport: ArrangeViewport;
}): boolean {
  const { boardId, preset, viewport } = input;
  const before = readBoard(boardId);
  if (!before) {
    return false;
  }
  const arrange = getBoardArrangeState(boardId);
  if (arrange.lastPreset === preset && arrange.snapshot) {
    return restoreBoardArrangement(boardId);
  }
  const arranged = arrangeBoardTabs(before, { preset, viewport });
  if (!arranged) {
    return false;
  }
  // Only the first arrange of a run saves a restore point, so pressing different presets in
  // a row still restores to the layout the user had before any of them.
  const snapshot = arrange.snapshot ?? { layout: before.layout, splitSizes: before.splitSizes };
  boardStore().putBoard(arranged);
  boardStore().patchArrange(boardId, { snapshot, lastPreset: preset });
  if (boardId === LIVE_BOARD_ID) {
    lastLiveViewport = viewport;
  }
  return true;
}

export function restoreBoardArrangement(boardId: string): boolean {
  const board = readBoard(boardId);
  const { snapshot } = getBoardArrangeState(boardId);
  if (!board || !snapshot) {
    return false;
  }
  boardStore().putBoard(restoreBoardLayout(board, snapshot));
  boardStore().patchArrange(boardId, { snapshot: null, lastPreset: null });
  return true;
}

export function equalizeBoardPanes(boardId: string): boolean {
  const board = readBoard(boardId);
  if (!board) {
    return false;
  }
  boardStore().putBoard(equalizeBoardLayout(board));
  return true;
}

// ---------------------------------------------------------------------------
// Agents, the way the sidebar reads them
// ---------------------------------------------------------------------------

function isAgentActive(agent: Agent): boolean {
  // Same rule as arrange/controller.ts listWatchCandidates: an open turn is what makes an
  // agent running, and isSidebarActiveAgent is the "needs a look" test (running, needs
  // input, failed, or finished and unread).
  let status = agent.status;
  if (agent.turn.phase === "open") {
    status = "running";
  } else if (agent.status === "running") {
    status = "idle";
  }
  return isSidebarActiveAgent({
    status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}

interface RootAgent {
  ref: BoardSessionRef;
  agent: Agent;
}

/** Every non-archived, non-subagent agent on every host, oldest first. */
const SPLIT_FALLBACK_SESSION_LIMIT = 5;

function activityTime(agent: { lastActivityAt?: Date | null; createdAt: Date }): number {
  return (agent.lastActivityAt ?? agent.createdAt).getTime();
}

function listRootAgents(sessions: SessionsState): RootAgent[] {
  const found: RootAgent[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    const agents = session?.agents;
    if (!agents) {
      continue;
    }
    for (const agent of agents.values()) {
      const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
      const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
      if (agent.archivedAt || !workspaceId || !isWorkspaceRootAgent(agent, parent)) {
        continue;
      }
      found.push({ ref: { serverId, workspaceId, agentId: agent.id }, agent });
    }
  }
  return found.sort(
    (a, b) =>
      a.agent.createdAt.getTime() - b.agent.createdAt.getTime() ||
      boardSessionKey(a.ref).localeCompare(boardSessionKey(b.ref)),
  );
}

/** Running or needing attention, across ALL hosts and workspaces. */
function listActiveRefs(sessions: SessionsState): BoardSessionRef[] {
  return listRootAgents(sessions)
    .filter(({ agent }) => isAgentActive(agent))
    .map(({ ref }) => ref);
}

// ---------------------------------------------------------------------------
// Split workspaces
// ---------------------------------------------------------------------------

function workspaceDisplayName(ref: WorkspaceRef): string {
  const workspaces = useSessionStore.getState().sessions[ref.serverId]?.workspaces;
  const wanted = normalizeWorkspaceOpaqueId(ref.workspaceId);
  const workspace =
    workspaces?.get(ref.workspaceId) ??
    [...(workspaces?.values() ?? [])].find(
      (candidate) => normalizeWorkspaceOpaqueId(candidate.id) === wanted,
    );
  return workspace?.title?.trim() || workspace?.name?.trim() || ref.workspaceId;
}

function splitBoardName(names: readonly string[]): string {
  if (names.length <= MAX_NAMED_WORKSPACES) {
    return names.join(" | ");
  }
  return `${names.slice(0, MAX_NAMED_WORKSPACES).join(" | ")} +${names.length - MAX_NAMED_WORKSPACES}`;
}

/**
 * What a workspace shows in its pane: the agent and file tabs it has open (layout order), with
 * the one it has focused showing; if none are open, its non-archived agents.
 */
function readWorkspaceGroup(ref: WorkspaceRef): BoardSplitGroup {
  const key = buildWorkspaceTabPersistenceKey(ref);
  const layout = key ? useWorkspaceLayoutStore.getState().layoutByWorkspace[key] : undefined;
  if (layout) {
    const tabs = collectAllTabs(layout.root);
    const refByTabId = new Map<string, BoardSessionRef>();
    const sessions: BoardSessionRef[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      let session: BoardSessionRef | null = null;
      if (tab.target.kind === "agent") {
        session = { ...ref, agentId: tab.target.agentId };
      } else if (tab.target.kind === "file") {
        session = { ...ref, path: tab.target.path };
      }
      if (!session) {
        continue;
      }
      refByTabId.set(tab.tabId, session);
      const sessionKey = boardSessionKey(session);
      if (!seen.has(sessionKey)) {
        seen.add(sessionKey);
        sessions.push(session);
      }
    }
    if (sessions.length > 0) {
      const focusedTabId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
      return { sessions, focused: (focusedTabId && refByTabId.get(focusedTabId)) || null };
    }
  }
  const wanted = normalizeWorkspaceOpaqueId(ref.workspaceId);
  // No open agent tabs: take the working agents, then the most recently active, capped so an
  // old workspace does not flood its pane with every agent it ever had.
  const sessions = listRootAgents(useSessionStore.getState().sessions)
    .filter(
      ({ ref: agentRef }) => agentRef.serverId === ref.serverId && agentRef.workspaceId === wanted,
    )
    .sort(
      (a, b) =>
        Number(isAgentActive(b.agent)) - Number(isAgentActive(a.agent)) ||
        activityTime(b.agent) - activityTime(a.agent),
    )
    .slice(0, SPLIT_FALLBACK_SESSION_LIMIT)
    .map(({ ref: agentRef }) => ({
      serverId: ref.serverId,
      workspaceId: ref.workspaceId,
      agentId: agentRef.agentId,
    }));
  return { sessions };
}

function focusedSessionKey(board: Board): string | null {
  const pane = findPaneById(board.layout.root, board.layout.focusedPaneId);
  const origin = pane?.focusedTabId ? board.origins[pane.focusedTabId] : undefined;
  return origin ? boardSessionKey(origin) : null;
}

/**
 * A board of several workspaces at once: one pane per workspace, each pane a tab strip of
 * that workspace's open agent and file tabs. "columns" = side by side, "grid" = Arrange's grid shape.
 * The same SET of workspaces (any order) reuses its board and refreshes it. Returns its id.
 */
export function splitWorkspaces(input: {
  workspaces: ReadonlyArray<{ serverId: string; workspaceId: string }>;
  layout: "columns" | "grid";
  viewport: ArrangeViewport | null;
}): string | null {
  const refs: WorkspaceRef[] = [];
  const keys: string[] = [];
  for (const workspace of input.workspaces) {
    const key = buildWorkspaceTabPersistenceKey(workspace);
    if (key && !keys.includes(key)) {
      keys.push(key);
      refs.push({ serverId: workspace.serverId.trim(), workspaceId: workspace.workspaceId.trim() });
    }
  }
  if (refs.length < 2) {
    return null;
  }

  const layout: BoardSplitLayout = input.layout;
  const viewport = input.viewport ?? DEFAULT_VIEWPORT;
  const groups = refs.map(readWorkspaceGroup);
  const setKey = JSON.stringify([...keys].sort());
  const existingId = boardStore().splitPairs[setKey];
  const existing = existingId ? readBoard(existingId) : null;

  if (!existing) {
    const built = buildWorkspaceSplit({ groups, layout, viewport });
    const board: Board = {
      id: createBoardId(),
      name: splitBoardName(refs.map(workspaceDisplayName)),
      createdAt: Date.now(),
      kind: "user",
      layout: built.layout,
      splitSizes: {},
      origins: built.origins,
    };
    boardStore().putBoard(board);
    boardStore().setSplitPair(setKey, board.id);
    return board.id;
  }

  // Reuse: sessions are re-read from the workspaces (newly opened tabs join, closed ones
  // leave); tabs that stay keep their id so their agent panels do not remount.
  const keepTabIds = new Map(
    Object.entries(existing.origins).map(([tabId, origin]) => [boardSessionKey(origin), tabId]),
  );
  const previousFocus = focusedSessionKey(existing);
  const built = buildWorkspaceSplit({ groups, layout, viewport, keepTabIds });
  let next: Board = { ...existing, layout: built.layout, origins: built.origins, splitSizes: {} };
  const focusedOrigin = Object.values(next.origins).find(
    (origin) => boardSessionKey(origin) === previousFocus,
  );
  const focusedTabId = focusedOrigin ? findBoardTabId(next, focusedOrigin) : null;
  const focusedPane = focusedTabId ? findPaneContainingTab(next.layout.root, focusedTabId) : null;
  if (focusedTabId && focusedPane) {
    next = selectBoardTabModel(next, focusedPane.id, focusedTabId);
  }
  boardStore().putBoard(next);
  // The layout was rebuilt, so a restore point from before would describe another arrangement.
  boardStore().patchArrange(existing.id, { snapshot: null, lastPreset: null });
  return existing.id;
}

// ---------------------------------------------------------------------------
// Live board
// ---------------------------------------------------------------------------

/** Re-read every agent that is running or needs you; finished ones leave only here. */
export function refreshLiveBoard(viewport: ArrangeViewport | null): void {
  const board = readBoard(LIVE_BOARD_ID);
  if (!board) {
    return;
  }
  if (viewport) {
    lastLiveViewport = viewport;
  }
  const active = listActiveRefs(useSessionStore.getState().sessions);
  boardStore().putBoard(rebuildLiveBoard(board, active, viewport ?? DEFAULT_VIEWPORT));
  boardStore().patchArrange(LIVE_BOARD_ID, { snapshot: null, lastPreset: null });
}

/** Agents that started working since the last look join the Live board; nothing leaves. */
function growLiveBoard(): void {
  const board = readBoard(LIVE_BOARD_ID);
  if (!board) {
    return;
  }
  const active = listActiveRefs(useSessionStore.getState().sessions);
  const next = appendActiveSessions(board, active, lastLiveViewport ?? DEFAULT_VIEWPORT);
  if (!next) {
    return;
  }
  boardStore().putBoard(next);
  // The restore snapshot stays, so Restore still goes back to before the Live grid grew; the
  // preset is cleared because the grid is no longer exactly what that preset made.
  boardStore().patchArrange(LIVE_BOARD_ID, { lastPreset: null });
}

/** Mount once at app level: running agents join the Live board as they start. */
export function useLiveBoardSync(): void {
  // A string, not a list: the store notifies on every agent update, and only a change in
  // WHO is active may restart the debounce.
  const activeKey = useSessionStore((state) =>
    listActiveRefs(state.sessions).map(boardSessionKey).sort().join("\n\n"),
  );
  const growRef = useRef(growLiveBoard);
  growRef.current = growLiveBoard;

  useEffect(() => {
    if (activeKey === "") {
      return;
    }
    const timer = setTimeout(() => growRef.current(), LIVE_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeKey]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useBoards(): readonly BoardSummary[] {
  const boards = useBoardStore((state) => state.boards);
  const order = useBoardStore((state) => state.order);
  return useMemo(
    () =>
      order.flatMap((id) => {
        const board = boards[id];
        return board
          ? [{ id, name: board.name, kind: board.kind, sessionCount: countBoardSessions(board) }]
          : [];
      }),
    [boards, order],
  );
}

export function useBoard(boardId: string | null): Board | null {
  return useBoardStore((state) => (boardId ? (state.boards[boardId] ?? null) : null));
}

export function getBoard(boardId: string): Board | null {
  return readBoard(boardId);
}

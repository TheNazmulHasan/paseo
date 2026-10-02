// Pure board math. No stores, no React: every rule here is tested against plain boards, and
// the controller only wires results into the store. A board's layout is a normal
// WorkspaceLayout with no Explorer, so Arrange's own model runs on it unchanged.
import {
  arrangeLayoutTabs,
  collectArrangeTabs,
  computeGridShape,
  equalizeLayout,
  pruneSplitSizes,
  reconcileSnapshot,
} from "@/arrange/model";
import type { ArrangePreset, ArrangeViewport } from "@/arrange/types";
import type { Board, BoardSessionRef, BoardTabOrigin } from "@/boards/types";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import type { WorkspaceLayoutNodeIdPrefix } from "@/stores/workspace-layout-ids";
import {
  clampNormalizedSizes,
  closeTabInLayout,
  collectAllPanes,
  findPaneById,
  findPaneContainingTab,
  focusPaneInLayout,
  getTreeDepth,
  moveTabToPaneInLayout,
  selectTabInPaneInLayout,
  type SplitNode,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";

/** Passed to Arrange's model wherever it asks for the Explorer: a board has none. */
export const NO_EXPLORER_PANE_ID = "__no_explorer__";

/** Beyond this many panes on one axis the minimum split size (0.1) cannot hold equal widths. */
const MAX_SPLIT_AXIS = 10;

/** Same ceiling the workspace layout store puts on its split tree. */
const MAX_BOARD_TREE_DEPTH = 5;
/** A file pane split off a source pane takes this share of the source's width. */
const FILE_PANE_SHARE = 0.4;

export type BoardSplitLayout = "columns" | "grid";

export interface BoardIds {
  createTabId: () => string;
  createNodeId: (prefix: WorkspaceLayoutNodeIdPrefix) => string;
  now: () => number;
}

export const DEFAULT_BOARD_IDS: BoardIds = {
  createTabId: () => `boardtab_${defaultWorkspaceLayoutIds.createNodeId("pane").slice(5)}`,
  createNodeId: defaultWorkspaceLayoutIds.createNodeId,
  now: () => Date.now(),
};

interface PaneWithTabs extends SplitPane {
  tabs: WorkspaceTab[];
}

type NodeWithTabs =
  | { kind: "pane"; pane: PaneWithTabs }
  | {
      kind: "group";
      group: {
        id: string;
        direction: "horizontal" | "vertical";
        children: NodeWithTabs[];
        sizes: number[];
      };
    };

type BoardEntryRef = Pick<BoardTabOrigin, "serverId" | "workspaceId" | "agentId" | "path">;

/**
 * Two entries are the same when they are the same agent on a host, or the same file path in
 * the same workspace (a file belongs to one workspace, an agent is addressed by host alone).
 */
export function boardSessionKey(ref: BoardEntryRef): string {
  if (ref.agentId === undefined) {
    return `file\n${ref.serverId}\n${ref.workspaceId}\n${ref.path ?? ""}`;
  }
  return `${ref.serverId}\n${ref.agentId}`;
}

/** The layout tab target for a board entry: the file when it has a path, else the agent. */
export function boardTabTarget(ref: BoardEntryRef): WorkspaceTabTarget {
  if (ref.agentId === undefined) {
    return createWorkspaceFileTabTarget({ path: ref.path ?? "" });
  }
  return { kind: "agent", agentId: ref.agentId };
}

function originOf(ref: BoardSessionRef): BoardTabOrigin {
  return ref.agentId === undefined
    ? { serverId: ref.serverId, workspaceId: ref.workspaceId, path: ref.path }
    : { serverId: ref.serverId, workspaceId: ref.workspaceId, agentId: ref.agentId };
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function makePane(id: string, tabs: WorkspaceTab[], focusedTabId?: string | null): PaneWithTabs {
  const tabIds = tabs.map((tab) => tab.tabId);
  return {
    id,
    tabs,
    tabIds,
    focusedTabId:
      focusedTabId && tabIds.includes(focusedTabId) ? focusedTabId : (tabIds[0] ?? null),
  };
}

function paneNode(id: string, tabs: WorkspaceTab[], focusedTabId?: string | null): NodeWithTabs {
  return { kind: "pane", pane: makePane(id, tabs, focusedTabId) };
}

function groupNode(
  id: string,
  direction: "horizontal" | "vertical",
  children: NodeWithTabs[],
): NodeWithTabs {
  return { kind: "group", group: { id, direction, children, sizes: equalSizes(children.length) } };
}

function asLayoutRoot(node: NodeWithTabs): SplitNode {
  return node as SplitNode;
}

function firstPaneId(root: NodeWithTabs): string | null {
  if (root.kind === "pane") {
    return root.pane.id;
  }
  for (const child of root.group.children) {
    const found = firstPaneId(child);
    if (found) {
      return found;
    }
  }
  return null;
}

/** One pane, no tabs: what a new board starts as. */
export function createEmptyBoardLayout(ids: BoardIds = DEFAULT_BOARD_IDS): WorkspaceLayout {
  const pane = paneNode(ids.createNodeId("pane"), []);
  return { root: asLayoutRoot(pane), focusedPaneId: firstPaneId(pane) };
}

/** Every tab on the board, in on-screen order. */
export function listBoardTabs(layout: WorkspaceLayout): WorkspaceTab[] {
  return collectArrangeTabs(layout, NO_EXPLORER_PANE_ID);
}

export function countBoardSessions(board: Board): number {
  return listBoardTabs(board.layout).length;
}

export function findBoardTabId(board: Board, ref: BoardSessionRef): string | null {
  const key = boardSessionKey(ref);
  for (const [tabId, origin] of Object.entries(board.origins)) {
    if (boardSessionKey(origin) === key) {
      return tabId;
    }
  }
  return null;
}

function updatePane(
  node: NodeWithTabs,
  paneId: string,
  update: (pane: PaneWithTabs) => PaneWithTabs,
): NodeWithTabs {
  if (node.kind === "pane") {
    return node.pane.id === paneId ? { kind: "pane", pane: update(node.pane) } : node;
  }
  return {
    kind: "group",
    group: {
      ...node.group,
      children: node.group.children.map((child) => updatePane(child, paneId, update)),
    },
  };
}

function resolveLandingPane(layout: WorkspaceLayout): SplitPane | null {
  const visible = collectAllPanes(layout.root);
  return (
    visible.find((pane) => pane.id === layout.focusedPaneId) ??
    visible[0] ??
    findPaneById(layout.root, layout.focusedPaneId)
  );
}

/**
 * Adds sessions (agent or file tabs) at the end of the focused pane (the last one added becomes the
 * selected tab). Sessions already on the board, or repeated in `sessions`, are skipped.
 */
export function addSessionsToBoardModel(
  board: Board,
  sessions: readonly BoardSessionRef[],
  ids: BoardIds = DEFAULT_BOARD_IDS,
): { board: Board; addedTabIds: string[] } {
  const known = new Set(Object.values(board.origins).map(boardSessionKey));
  const origins = { ...board.origins };
  const added: WorkspaceTab[] = [];
  for (const session of sessions) {
    const key = boardSessionKey(session);
    if (known.has(key)) {
      continue;
    }
    known.add(key);
    const tab: WorkspaceTab = {
      tabId: ids.createTabId(),
      target: boardTabTarget(session),
      createdAt: ids.now(),
    };
    added.push(tab);
    origins[tab.tabId] = originOf(session);
  }
  const landing = resolveLandingPane(board.layout);
  if (added.length === 0 || !landing) {
    return { board, addedTabIds: [] };
  }
  const root = updatePane(board.layout.root as NodeWithTabs, landing.id, (pane) =>
    makePane(pane.id, [...pane.tabs, ...added], added[added.length - 1]?.tabId),
  );
  return {
    board: {
      ...board,
      origins,
      layout: { ...board.layout, root: asLayoutRoot(root), focusedPaneId: landing.id },
    },
    addedTabIds: added.map((tab) => tab.tabId),
  };
}

function dropNewTabs(node: NodeWithTabs): NodeWithTabs {
  if (node.kind === "group") {
    return {
      kind: "group",
      group: { ...node.group, children: node.group.children.map(dropNewTabs) },
    };
  }
  const tabs = node.pane.tabs.filter((tab) => tab.target.kind !== "new_tab");
  return tabs.length === node.pane.tabs.length
    ? node
    : paneNode(node.pane.id, tabs, node.pane.focusedTabId);
}

/** Closes a tab, forgets its origin, and collapses a pane it empties (never the last pane). */
export function removeTabFromBoard(board: Board, tabId: string): Board {
  const closed = closeTabInLayout({ layout: board.layout, tabId, explorerSidebarPaneId: null });
  if (!closed) {
    return board;
  }
  // The workspace layout refills its last pane with a "new tab" placeholder; a board has no
  // such tab (every tab is an agent), so the pane is left empty instead.
  const layout = { ...closed, root: asLayoutRoot(dropNewTabs(closed.root as NodeWithTabs)) };
  const { [tabId]: _removed, ...origins } = board.origins;
  return { ...board, layout, origins };
}

export function moveBoardTab(board: Board, tabId: string, toPaneId: string): Board {
  const layout = moveTabToPaneInLayout({ layout: board.layout, tabId, toPaneId });
  return layout ? { ...board, layout } : board;
}

export function focusBoardPaneModel(board: Board, paneId: string): Board {
  const layout = focusPaneInLayout({ layout: board.layout, paneId });
  return layout ? { ...board, layout } : board;
}

/** Selects the tab in its pane and makes that pane the focused one, like clicking it. */
export function selectBoardTabModel(board: Board, paneId: string, tabId: string): Board {
  const selected = selectTabInPaneInLayout({ layout: board.layout, paneId, tabId });
  const focused = focusPaneInLayout({ layout: selected ?? board.layout, paneId });
  const layout = focused ?? selected;
  return layout ? { ...board, layout } : board;
}

function findGroupChildCount(node: SplitNode, groupId: string): number | null {
  if (node.kind === "pane") {
    return null;
  }
  if (node.group.id === groupId) {
    return node.group.children.length;
  }
  for (const child of node.group.children) {
    const found = findGroupChildCount(child, groupId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Stores a dragged divider as an override, clamped like the workspace store does. */
export function resizeBoardSplitModel(board: Board, groupId: string, sizes: number[]): Board {
  if (findGroupChildCount(board.layout.root, groupId) !== sizes.length) {
    return board;
  }
  return { ...board, splitSizes: { ...board.splitSizes, [groupId]: clampNormalizedSizes(sizes) } };
}

/** Re-arranges the board's sessions (all of them, in on-screen order unless `tabIds` says otherwise). */
export function arrangeBoardTabs(
  board: Board,
  input: { preset: ArrangePreset; viewport: ArrangeViewport; tabIds?: readonly string[] },
): Board | null {
  const tabIds = input.tabIds ?? listBoardTabs(board.layout).map((tab) => tab.tabId);
  const layout = arrangeLayoutTabs(board.layout, {
    tabIds,
    preset: input.preset,
    viewport: input.viewport,
    explorerPaneId: NO_EXPLORER_PANE_ID,
  });
  return layout ? { ...board, layout, splitSizes: {} } : null;
}

export function equalizeBoardLayout(board: Board): Board {
  // Dragged dividers live in split-size overrides; clearing them is what makes it equal.
  return {
    ...board,
    layout: equalizeLayout(board.layout, NO_EXPLORER_PANE_ID),
    splitSizes: {},
  };
}

/** Puts a saved layout back, minus tabs closed since and plus tabs opened since. */
export function restoreBoardLayout(
  board: Board,
  snapshot: { layout: WorkspaceLayout; splitSizes: Record<string, number[]> },
  ids: BoardIds = DEFAULT_BOARD_IDS,
): Board {
  const layout = reconcileSnapshot(snapshot.layout, listBoardTabs(board.layout), {
    explorerPaneId: NO_EXPLORER_PANE_ID,
    currentExplorerPane: null,
    createNodeId: ids.createNodeId,
  });
  return { ...board, layout, splitSizes: pruneSplitSizes(layout, snapshot.splitSizes) };
}

/**
 * Deals groups onto `cells` panes: one each, then the overflow round-robin as extra tabs.
 * A pane keeps the focused tab of the group that owns the cell.
 */
function dealIntoCells(
  groups: ReadonlyArray<{ tabs: WorkspaceTab[]; focusedTabId: string | null }>,
  cells: number,
): Array<{ tabs: WorkspaceTab[]; focusedTabId: string | null }> {
  const panes = Array.from({ length: Math.min(cells, groups.length) }, () => ({
    tabs: [] as WorkspaceTab[],
    focusedTabId: null as string | null,
  }));
  groups.forEach((group, index) => {
    const pane = panes[index < panes.length ? index : (index - panes.length) % panes.length];
    if (!pane) {
      return;
    }
    pane.tabs.push(...group.tabs);
    if (index < panes.length) {
      pane.focusedTabId = group.focusedTabId;
    }
  });
  return panes;
}

/** One pane's worth of sessions; `focused` is the tab that shows (default: the first). */
export interface BoardSplitGroup {
  sessions: readonly BoardSessionRef[];
  focused?: BoardSessionRef | null;
}

/**
 * One pane per group of sessions, each pane a tab strip. "columns" puts the panes side by
 * side with equal widths; "grid" lays them out like Arrange's grid for this viewport.
 * `keepTabIds` (session key → tab id) lets a rebuild keep the tabs that already exist, so
 * their agent panels do not remount.
 */
export function buildWorkspaceSplit(input: {
  groups: readonly BoardSplitGroup[];
  layout: BoardSplitLayout;
  viewport: ArrangeViewport;
  keepTabIds?: ReadonlyMap<string, string>;
  ids?: BoardIds;
}): { layout: WorkspaceLayout; origins: Record<string, BoardTabOrigin> } {
  const ids = input.ids ?? DEFAULT_BOARD_IDS;
  const origins: Record<string, BoardTabOrigin> = {};
  const seen = new Set<string>();
  const tabGroups = input.groups.map((group) => {
    const focusedKey = group.focused ? boardSessionKey(group.focused) : null;
    let focusedTabId: string | null = null;
    const tabs = group.sessions.flatMap((session) => {
      const key = boardSessionKey(session);
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      const tab: WorkspaceTab = {
        tabId: input.keepTabIds?.get(key) ?? ids.createTabId(),
        target: boardTabTarget(session),
        createdAt: ids.now(),
      };
      origins[tab.tabId] = originOf(session);
      if (key === focusedKey) {
        focusedTabId = tab.tabId;
      }
      return [tab];
    });
    return { tabs, focusedTabId };
  });
  if (tabGroups.length === 0) {
    return { layout: createEmptyBoardLayout(ids), origins };
  }

  const shape =
    input.layout === "grid"
      ? computeGridShape(tabGroups.length, input.viewport).rowCounts
      : [Math.min(tabGroups.length, MAX_SPLIT_AXIS)];
  const cells = shape.reduce((sum, count) => sum + count, 0);
  const panes = dealIntoCells(tabGroups, cells).map(({ tabs, focusedTabId }) =>
    paneNode(ids.createNodeId("pane"), tabs, focusedTabId),
  );

  let cursor = 0;
  const rows = shape.map((count) => {
    const rowPanes = panes.slice(cursor, cursor + count);
    cursor += count;
    return rowPanes.length === 1 && rowPanes[0]
      ? rowPanes[0]
      : groupNode(ids.createNodeId("group"), "horizontal", rowPanes);
  });
  const root =
    rows.length === 1 && rows[0] ? rows[0] : groupNode(ids.createNodeId("group"), "vertical", rows);
  return {
    layout: { root: asLayoutRoot(root), focusedPaneId: firstPaneId(root) },
    origins,
  };
}

/**
 * The Live board's growth step: newly active sessions join and the board is re-gridded over
 * (current tabs in order + the newcomers). Nothing is ever removed here; finished sessions
 * stay until a refresh. Returns null when nobody is new.
 */
export function appendActiveSessions(
  board: Board,
  active: readonly BoardSessionRef[],
  viewport: ArrangeViewport,
  ids: BoardIds = DEFAULT_BOARD_IDS,
): Board | null {
  const current = listBoardTabs(board.layout).map((tab) => tab.tabId);
  const { board: grown, addedTabIds } = addSessionsToBoardModel(board, active, ids);
  if (addedTabIds.length === 0) {
    return null;
  }
  return (
    arrangeBoardTabs(grown, { preset: "grid", viewport, tabIds: [...current, ...addedTabIds] }) ??
    grown
  );
}

/**
 * The Live board's reset: a grid of exactly `active`. Sessions that were already on the board
 * keep their tab (and on-screen order); the rest follow in the order given.
 */
export function rebuildLiveBoard(
  board: Board,
  active: readonly BoardSessionRef[],
  viewport: ArrangeViewport,
  ids: BoardIds = DEFAULT_BOARD_IDS,
): Board {
  const wanted = new Map(active.map((session) => [boardSessionKey(session), session]));
  const kept: BoardSessionRef[] = [];
  const keepTabIds = new Map<string, string>();
  for (const tab of listBoardTabs(board.layout)) {
    const origin = board.origins[tab.tabId];
    const key = origin ? boardSessionKey(origin) : null;
    if (origin && key && wanted.has(key) && !keepTabIds.has(key)) {
      keepTabIds.set(key, tab.tabId);
      kept.push(origin);
    }
  }
  const ordered = [...kept, ...active];
  const grouped = buildWorkspaceSplit({
    groups: [{ sessions: ordered }],
    layout: "columns",
    viewport,
    keepTabIds,
    ids,
  });
  const single: Board = { ...board, layout: grouped.layout, origins: grouped.origins };
  return (
    arrangeBoardTabs({ ...single, splitSizes: {} }, { preset: "grid", viewport }) ?? {
      ...single,
      splitSizes: {},
    }
  );
}

// ---------------------------------------------------------------------------
// Files beside their workspace
// ---------------------------------------------------------------------------

type WorkspaceRef = Pick<BoardTabOrigin, "serverId" | "workspaceId">;

function sameWorkspace(a: WorkspaceRef, b: WorkspaceRef): boolean {
  return a.serverId === b.serverId && a.workspaceId === b.workspaceId;
}

/**
 * A "files pane" of a workspace: it has tabs, every one a file tab, and every one belongs to
 * that workspace. An agent tab (or a tab of another workspace) disqualifies the pane for good.
 */
export function isFilesPaneOfWorkspace(
  board: Pick<Board, "origins">,
  pane: SplitPane,
  workspace: WorkspaceRef,
): boolean {
  const tabs = (pane as PaneWithTabs).tabs;
  if (!tabs || tabs.length === 0) {
    return false;
  }
  return tabs.every((tab) => {
    const origin = board.origins[tab.tabId];
    return tab.target.kind === "file" && origin !== undefined && sameWorkspace(origin, workspace);
  });
}

/** The pane directly right of `paneId` in its own horizontal group, when that sibling is a pane. */
function findRightSiblingPane(root: SplitNode, paneId: string): SplitPane | null {
  if (root.kind === "pane") {
    return null;
  }
  const { group } = root;
  const index = group.children.findIndex(
    (child) => child.kind === "pane" && child.pane.id === paneId,
  );
  if (index >= 0) {
    const next = group.children[index + 1];
    return group.direction === "horizontal" && next?.kind === "pane" ? next.pane : null;
  }
  for (const child of group.children) {
    const found = findRightSiblingPane(child, paneId);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Puts `added` in a new pane right of `sourcePaneId`. Inside a horizontal group the source's
 * share is split source 60 / new 40; otherwise the source is wrapped in a new horizontal group.
 * `resizedGroupId` names a group whose child count changed, so a stored size override is stale.
 */
function insertPaneRightOf(
  node: NodeWithTabs,
  sourcePaneId: string,
  added: NodeWithTabs,
  splitSizes: Record<string, number[]>,
  ids: BoardIds,
): { node: NodeWithTabs; resizedGroupId: string | null } | null {
  if (node.kind === "pane") {
    if (node.pane.id !== sourcePaneId) {
      return null;
    }
    const wrapped = groupNode(ids.createNodeId("group"), "horizontal", [node, added]);
    if (wrapped.kind === "group") {
      wrapped.group.sizes = [1 - FILE_PANE_SHARE, FILE_PANE_SHARE];
    }
    return { node: wrapped, resizedGroupId: null };
  }
  const { group } = node;
  const index = group.children.findIndex(
    (child) => child.kind === "pane" && child.pane.id === sourcePaneId,
  );
  if (index >= 0 && group.direction === "horizontal") {
    const override = splitSizes[group.id];
    const current = override?.length === group.children.length ? override : group.sizes;
    const share = current[index] ?? 1 / group.children.length;
    const sizes = current.slice();
    sizes.splice(index, 1, share * (1 - FILE_PANE_SHARE), share * FILE_PANE_SHARE);
    const children = group.children.slice();
    children.splice(index + 1, 0, added);
    return {
      node: { kind: "group", group: { ...group, children, sizes } },
      resizedGroupId: group.id,
    };
  }
  for (let i = 0; i < group.children.length; i += 1) {
    const child = group.children[i];
    const result = child ? insertPaneRightOf(child, sourcePaneId, added, splitSizes, ids) : null;
    if (result) {
      const children = group.children.slice();
      children[i] = result.node;
      return {
        node: { kind: "group", group: { ...group, children } },
        resizedGroupId: result.resizedGroupId,
      };
    }
  }
  return null;
}

/** Selects a tab inside its pane without moving pane focus (the source pane keeps it). */
function selectTabKeepingFocus(board: Board, paneId: string, tabId: string): Board {
  const layout = selectTabInPaneInLayout({ layout: board.layout, paneId, tabId });
  return layout ? { ...board, layout } : board;
}

/**
 * Opens a file as a tab beside the pane it was asked from, belonging to the same workspace.
 * Order: the file is already on the board (select it); the source pane is itself that
 * workspace's files pane (add there); the pane to the right is that workspace's files pane (add
 * there); else split a new pane right of the source (60/40). Agent panes never receive files.
 * Returns null when nothing fits (unknown pane, bad path, or the split tree is too deep), so
 * the caller can fall back to the workspace screen.
 */
export function openFileBesideModel(
  board: Board,
  input: { sourcePaneId: string; origin: WorkspaceRef; location: WorkspaceFileLocation },
  ids: BoardIds = DEFAULT_BOARD_IDS,
): { board: Board; tabId: string; paneId: string } | null {
  const location = normalizeWorkspaceFileLocation(input.location);
  const source = findPaneById(board.layout.root, input.sourcePaneId);
  if (!location || !source) {
    return null;
  }
  const workspace: WorkspaceRef = {
    serverId: input.origin.serverId,
    workspaceId: input.origin.workspaceId,
  };
  const ref: BoardSessionRef = { ...workspace, path: location.path };

  const existingTabId = findBoardTabId(board, ref);
  const existingPane = existingTabId
    ? findPaneContainingTab(board.layout.root, existingTabId)
    : null;
  if (existingTabId && existingPane) {
    return {
      board: selectTabKeepingFocus(board, existingPane.id, existingTabId),
      tabId: existingTabId,
      paneId: existingPane.id,
    };
  }

  const tab: WorkspaceTab = {
    tabId: ids.createTabId(),
    target: createWorkspaceFileTabTarget(location),
    createdAt: ids.now(),
  };
  const origins = { ...board.origins, [tab.tabId]: originOf(ref) };

  const host = isFilesPaneOfWorkspace(board, source, workspace)
    ? source
    : findRightSiblingPane(board.layout.root, source.id);
  if (host && isFilesPaneOfWorkspace(board, host, workspace)) {
    const root = updatePane(board.layout.root as NodeWithTabs, host.id, (pane) =>
      makePane(pane.id, [...pane.tabs, tab], tab.tabId),
    );
    return {
      board: { ...board, origins, layout: { ...board.layout, root: asLayoutRoot(root) } },
      tabId: tab.tabId,
      paneId: host.id,
    };
  }

  const newPaneId = ids.createNodeId("pane");
  const inserted = insertPaneRightOf(
    board.layout.root as NodeWithTabs,
    source.id,
    paneNode(newPaneId, [tab]),
    board.splitSizes,
    ids,
  );
  if (!inserted || getTreeDepth(asLayoutRoot(inserted.node)) > MAX_BOARD_TREE_DEPTH) {
    return null;
  }
  const splitSizes = { ...board.splitSizes };
  if (inserted.resizedGroupId) {
    delete splitSizes[inserted.resizedGroupId];
  }
  return {
    board: {
      ...board,
      origins,
      splitSizes,
      layout: { ...board.layout, root: asLayoutRoot(inserted.node) },
    },
    tabId: tab.tabId,
    paneId: newPaneId,
  };
}

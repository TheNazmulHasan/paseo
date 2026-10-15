// Pure layout math for Arrange. No stores, no React: every rule here is tested
// against plain layout objects, and the controller only wires the results in.
import type { ArrangePreset, ArrangeViewport } from "@/arrange/types";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import type { WorkspaceLayoutNodeIdPrefix } from "@/stores/workspace-layout-ids";
import {
  EXPLORER_SIDEBAR_PANE_ID,
  getTreeDepth,
  type SplitGroup,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";

// Mirrors MAX_TREE_DEPTH in workspace-layout-store.ts (private there). The tree
// includes the Explorer wrapper group, which the renderer docks separately.
const MAX_TREE_DEPTH = 5;
// MIN_SPLIT_SIZE is 0.1, so more than ten panes on one axis could not keep equal sizes.
const MAX_GRID_AXIS = 10;
const DEFAULT_VIEWPORT: ArrangeViewport = { width: 1440, height: 900 };
const DEFAULT_EXPLORER_SHARE = 0.22;
// Chat and terminal panes read best close to square, so the grid aims for that
// and lets the window's own shape decide rows versus columns.
const TARGET_PANE_ASPECT = 1;
// An empty cell is a hole in the screen; this is how much worse it is than a stretched pane.
const EMPTY_CELL_PENALTY = 0.25;
const COST_EPSILON = 1e-9;

interface PaneInternal extends SplitPane {
  tabs: WorkspaceTab[];
}

interface GroupInternal extends Omit<SplitGroup, "children"> {
  children: NodeInternal[];
}

type NodeInternal = { kind: "pane"; pane: PaneInternal } | { kind: "group"; group: GroupInternal };

type CreateNodeId = (prefix: WorkspaceLayoutNodeIdPrefix) => string;

export interface GridShape {
  /** Panes per row, top to bottom. Never contains a 0. */
  rowCounts: number[];
}

export interface ArrangeLayoutInput {
  /** Ordered tabs to arrange. Ids that are not open are ignored. */
  tabIds: readonly string[];
  preset: ArrangePreset;
  viewport: ArrangeViewport;
  /** Defaults to the stock Explorer pane id. Pass null when the layout has none. */
  explorerPaneId?: string | null;
  createNodeId?: CreateNodeId;
}

export interface ReconcileSnapshotOptions {
  explorerPaneId?: string | null;
  /** The Explorer as it is now; it replaces the snapshot's copy so restoring never moves it. */
  currentExplorerPane?: SplitPane | null;
  createNodeId?: CreateNodeId;
}

function asNode(node: WorkspaceLayout["root"]): NodeInternal {
  return node as NodeInternal;
}

function resolveExplorerId(explorerPaneId: string | null | undefined): string | null {
  return explorerPaneId === undefined ? EXPLORER_SIDEBAR_PANE_ID : explorerPaneId;
}

function paneTabs(pane: PaneInternal): WorkspaceTab[] {
  return Array.isArray(pane.tabs) ? pane.tabs : [];
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Splits `total` into `parts` near-equal counts, earlier parts taking the remainder. */
function distribute(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

function dealContiguous<T>(items: readonly T[], parts: number): T[][] {
  const chunks: T[][] = [];
  let cursor = 0;
  for (const size of distribute(items.length, parts)) {
    chunks.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks;
}

export function computeGridShape(
  count: number,
  viewport: ArrangeViewport,
  minPaneWidth = 360,
  minPaneHeight = 220,
): GridShape {
  const total = Math.floor(count);
  if (!(total > 0)) {
    return { rowCounts: [] };
  }
  const width = positiveOr(viewport.width, DEFAULT_VIEWPORT.width);
  const height = positiveOr(viewport.height, DEFAULT_VIEWPORT.height);
  const maxCols = clampInt(width / positiveOr(minPaneWidth, 1), 1, MAX_GRID_AXIS);
  const maxRows = clampInt(height / positiveOr(minPaneHeight, 1), 1, MAX_GRID_AXIS);
  if (total > maxCols * maxRows) {
    // More tabs than the screen can hold: fill every cell, the rest stack as tabs.
    return { rowCounts: Array.from({ length: maxRows }, () => maxCols) };
  }

  let best: { rows: number; cols: number; cost: number } | null = null;
  for (let rows = 1; rows <= Math.min(maxRows, total); rows += 1) {
    const cols = Math.ceil(total / rows);
    if (cols > maxCols) {
      continue;
    }
    const paneAspect = width / cols / (height / rows);
    const cost =
      Math.abs(Math.log(paneAspect / TARGET_PANE_ASPECT)) +
      EMPTY_CELL_PENALTY * (rows * cols - total);
    const isBetter =
      !best ||
      cost < best.cost - COST_EPSILON ||
      // Equal cost: side-by-side panes beat stacked ones.
      (Math.abs(cost - best.cost) <= COST_EPSILON && cols > best.cols);
    if (isBetter) {
      best = { rows, cols, cost };
    }
  }
  // Unreachable in practice (rows = min(maxRows, total) always fits), kept for the type.
  const rows = best?.rows ?? 1;
  return { rowCounts: distribute(total, rows) };
}

function collectPaneNodes(node: NodeInternal, explorerPaneId: string | null): PaneInternal[] {
  if (node.kind === "pane") {
    return node.pane.id === explorerPaneId ? [] : [node.pane];
  }
  return node.group.children.flatMap((child) => collectPaneNodes(child, explorerPaneId));
}

function findPaneNode(node: NodeInternal, paneId: string): NodeInternal | null {
  if (node.kind === "pane") {
    return node.pane.id === paneId ? node : null;
  }
  for (const child of node.group.children) {
    const found = findPaneNode(child, paneId);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Every tab outside the Explorer, in layout order. */
export function collectArrangeTabs(
  layout: WorkspaceLayout,
  explorerPaneId?: string | null,
): WorkspaceTab[] {
  return collectPaneNodes(asNode(layout.root), resolveExplorerId(explorerPaneId)).flatMap(paneTabs);
}

function makePane(id: string, tabs: WorkspaceTab[], focusedTabId?: string | null): NodeInternal {
  const tabIds = tabs.map((tab) => tab.tabId);
  return {
    kind: "pane",
    pane: {
      id,
      tabs,
      tabIds,
      focusedTabId:
        focusedTabId && tabIds.includes(focusedTabId) ? focusedTabId : (tabIds[0] ?? null),
    },
  };
}

function makeGroup(
  id: string,
  direction: "horizontal" | "vertical",
  children: NodeInternal[],
): NodeInternal {
  return { kind: "group", group: { id, direction, children, sizes: equalSizes(children.length) } };
}

/**
 * Puts the Explorer back around a rebuilt main area. The renderer docks it outside the
 * split tree, so only its pane (hidden flag included) and its side of the root matter.
 */
function attachExplorer(
  oldRoot: NodeInternal,
  explorerPaneId: string | null,
  mainRoot: NodeInternal,
  createNodeId: CreateNodeId,
): NodeInternal {
  const explorerNode = explorerPaneId ? findPaneNode(oldRoot, explorerPaneId) : null;
  if (!explorerNode) {
    return mainRoot;
  }
  if (oldRoot.kind === "group") {
    const index = oldRoot.group.children.indexOf(explorerNode);
    if (index >= 0) {
      const total = oldRoot.group.sizes.reduce((sum, size) => sum + size, 0);
      const rawShare = total > 0 ? (oldRoot.group.sizes[index] ?? 0) / total : 0;
      const share = rawShare > 0 && rawShare < 1 ? rawShare : DEFAULT_EXPLORER_SHARE;
      const explorerFirst = index === 0;
      return {
        kind: "group",
        group: {
          id: oldRoot.group.id,
          direction: oldRoot.group.direction,
          children: explorerFirst ? [explorerNode, mainRoot] : [mainRoot, explorerNode],
          sizes: explorerFirst ? [share, 1 - share] : [1 - share, share],
        },
      };
    }
  }
  return {
    kind: "group",
    group: {
      id: createNodeId("group"),
      direction: "horizontal",
      children: [mainRoot, explorerNode],
      sizes: [1 - DEFAULT_EXPLORER_SHARE, DEFAULT_EXPLORER_SHARE],
    },
  };
}

function planPaneTabs(
  arranged: WorkspaceTab[],
  input: ArrangeLayoutInput,
): { paneTabs: WorkspaceTab[][]; rowCounts: number[] } {
  if (input.preset === "single") {
    return { paneTabs: [arranged], rowCounts: [1] };
  }
  if (input.preset === "columns-2" || input.preset === "columns-3") {
    const columns = Math.min(input.preset === "columns-2" ? 2 : 3, arranged.length);
    return { paneTabs: dealContiguous(arranged, columns), rowCounts: [columns] };
  }
  const { rowCounts } = computeGridShape(arranged.length, input.viewport);
  const cells = rowCounts.reduce((sum, value) => sum + value, 0);
  const panes: WorkspaceTab[][] = Array.from({ length: cells }, () => []);
  arranged.forEach((tab, index) => {
    // One tab per cell first, then the overflow is dealt round-robin as extra tabs.
    panes[index < cells ? index : (index - cells) % cells]?.push(tab);
  });
  return { paneTabs: panes, rowCounts };
}

/**
 * Rebuilds the workspace's split tree for `preset` over `tabIds`. Tabs outside
 * `tabIds` are never closed or hidden: they ride along as background tabs at the
 * end of the first pane. The Explorer pane is carried over untouched.
 */
export function arrangeLayoutTabs(
  layout: WorkspaceLayout,
  input: ArrangeLayoutInput,
): WorkspaceLayout | null {
  const explorerPaneId = resolveExplorerId(input.explorerPaneId);
  const createNodeId = input.createNodeId ?? defaultWorkspaceLayoutIds.createNodeId;
  const oldRoot = asNode(layout.root);
  const allTabs = collectArrangeTabs(layout, explorerPaneId);
  const byId = new Map(allTabs.map((tab) => [tab.tabId, tab]));
  const arranged: WorkspaceTab[] = [];
  const arrangedIds = new Set<string>();
  for (const tabId of input.tabIds) {
    const tab = byId.get(tabId);
    if (tab && !arrangedIds.has(tabId)) {
      arrangedIds.add(tabId);
      arranged.push(tab);
    }
  }
  if (arranged.length === 0) {
    return null;
  }

  const plan = planPaneTabs(arranged, input);
  const background = allTabs.filter((tab) => !arrangedIds.has(tab.tabId));
  const reusablePaneIds = collectPaneNodes(oldRoot, explorerPaneId).map((pane) => pane.id);
  const panes = plan.paneTabs.map((tabs, index) => {
    const id = reusablePaneIds[index] ?? createNodeId("pane");
    const focused = tabs[0]?.tabId ?? null;
    return makePane(id, index === 0 ? [...tabs, ...background] : tabs, focused);
  });

  let cursor = 0;
  const rows = plan.rowCounts.map((count) => {
    const rowPanes = panes.slice(cursor, cursor + count);
    cursor += count;
    return rowPanes.length === 1 && rowPanes[0]
      ? rowPanes[0]
      : makeGroup(createNodeId("group"), "horizontal", rowPanes);
  });
  const mainRoot =
    rows.length === 1 && rows[0] ? rows[0] : makeGroup(createNodeId("group"), "vertical", rows);

  const root = attachExplorer(oldRoot, explorerPaneId, mainRoot, createNodeId);
  const firstPane = panes[0];
  const next: WorkspaceLayout = {
    root: root as WorkspaceLayout["root"],
    focusedPaneId: firstPane?.kind === "pane" ? firstPane.pane.id : null,
    ...(layout.parentTabIdByTabId ? { parentTabIdByTabId: layout.parentTabIdByTabId } : {}),
  };
  return getTreeDepth(next.root) > MAX_TREE_DEPTH ? null : next;
}

function equalizeNode(node: NodeInternal, explorerPaneId: string | null): NodeInternal {
  if (node.kind === "pane") {
    return node;
  }
  const children = node.group.children.map((child) => equalizeNode(child, explorerPaneId));
  const explorerIndex = children.findIndex(
    (child) => child.kind === "pane" && child.pane.id === explorerPaneId,
  );
  let sizes = equalSizes(children.length);
  if (explorerIndex >= 0 && children.length > 1) {
    // The Explorer keeps its share; only the panes beside it are evened out.
    const total = node.group.sizes.reduce((sum, size) => sum + size, 0);
    const rawShare = total > 0 ? (node.group.sizes[explorerIndex] ?? 0) / total : 0;
    const share = rawShare > 0 && rawShare < 1 ? rawShare : 1 / children.length;
    sizes = children.map((_, index) =>
      index === explorerIndex ? share : (1 - share) / (children.length - 1),
    );
  }
  return { kind: "group", group: { ...node.group, children, sizes } };
}

export function equalizeLayout(
  layout: WorkspaceLayout,
  explorerPaneId?: string | null,
): WorkspaceLayout {
  return {
    ...layout,
    root: equalizeNode(
      asNode(layout.root),
      resolveExplorerId(explorerPaneId),
    ) as WorkspaceLayout["root"],
  };
}

function rebuildPane(pane: PaneInternal, tabs: WorkspaceTab[]): PaneInternal {
  const tabIds = tabs.map((tab) => tab.tabId);
  return {
    ...pane,
    tabs,
    tabIds,
    focusedTabId: tabIds.includes(pane.focusedTabId ?? "")
      ? pane.focusedTabId
      : (tabIds[0] ?? null),
  };
}

function pruneNode(
  node: NodeInternal,
  keepPaneId: string | null,
  explorerPaneId: string | null,
): NodeInternal | null {
  if (node.kind === "pane") {
    // The Explorer is exempt: it may be empty and hidden, and it is not ours to remove.
    return paneTabs(node.pane).length > 0 ||
      node.pane.id === keepPaneId ||
      node.pane.id === explorerPaneId
      ? node
      : null;
  }
  const kept: Array<{ node: NodeInternal; size: number }> = [];
  node.group.children.forEach((child, index) => {
    const next = pruneNode(child, keepPaneId, explorerPaneId);
    if (next) {
      kept.push({ node: next, size: node.group.sizes[index] ?? 1 });
    }
  });
  if (kept.length === 0) {
    return null;
  }
  if (kept.length === 1 && kept[0]) {
    return kept[0].node;
  }
  const total = kept.reduce((sum, entry) => sum + entry.size, 0);
  return {
    kind: "group",
    group: {
      ...node.group,
      children: kept.map((entry) => entry.node),
      sizes: kept.map((entry) => (total > 0 ? entry.size / total : 1 / kept.length)),
    },
  };
}

function mapPanes(node: NodeInternal, update: (pane: PaneInternal) => PaneInternal): NodeInternal {
  if (node.kind === "pane") {
    return { kind: "pane", pane: update(node.pane) };
  }
  return {
    kind: "group",
    group: { ...node.group, children: node.group.children.map((child) => mapPanes(child, update)) },
  };
}

/** A snapshot that predates the Explorer gets the current one docked, so restoring cannot lose it. */
function ensureDockedExplorer(
  root: NodeInternal,
  liveExplorer: SplitPane | null | undefined,
  createNodeId: CreateNodeId,
): NodeInternal {
  if (!liveExplorer || findPaneNode(root, liveExplorer.id)) {
    return root;
  }
  return {
    kind: "group",
    group: {
      id: createNodeId("group"),
      direction: "horizontal",
      children: [root, { kind: "pane", pane: liveExplorer as PaneInternal }],
      sizes: [1 - DEFAULT_EXPLORER_SHARE, DEFAULT_EXPLORER_SHARE],
    },
  };
}

/** A snapshot with nothing but the Explorer: give the tabs somewhere to land. */
function withEmptyOrdinaryPane(
  root: NodeInternal,
  explorerPaneId: string | null,
  createNodeId: CreateNodeId,
): NodeInternal {
  const emptyPane = makePane(createNodeId("pane"), []);
  const explorerNode = explorerPaneId ? findPaneNode(root, explorerPaneId) : null;
  return explorerNode
    ? makeGroup(createNodeId("group"), "horizontal", [emptyPane, explorerNode])
    : emptyPane;
}

/**
 * Brings an older layout up to date before it is put back: tabs that were closed
 * since are dropped, tabs opened since join the snapshot's focused pane, panes
 * left empty collapse away (never the last one). The current Explorer pane wins
 * over the snapshot's so restoring cannot move it.
 */
export function reconcileSnapshot(
  snapshot: WorkspaceLayout,
  currentTabs: readonly WorkspaceTab[],
  options: ReconcileSnapshotOptions = {},
): WorkspaceLayout {
  const explorerPaneId = resolveExplorerId(options.explorerPaneId);
  const createNodeId = options.createNodeId ?? defaultWorkspaceLayoutIds.createNodeId;
  const current = new Map(currentTabs.map((tab) => [tab.tabId, tab]));
  const snapshotTabIds = new Set(collectArrangeTabs(snapshot, explorerPaneId).map((t) => t.tabId));

  let root = mapPanes(asNode(snapshot.root), (pane) => {
    if (pane.id === explorerPaneId) {
      return options.currentExplorerPane && options.currentExplorerPane.id === pane.id
        ? (options.currentExplorerPane as PaneInternal)
        : pane;
    }
    const surviving = paneTabs(pane).flatMap((tab) => {
      const fresh = current.get(tab.tabId);
      return fresh ? [fresh] : [];
    });
    return rebuildPane(pane, surviving);
  });

  root = ensureDockedExplorer(root, options.currentExplorerPane, createNodeId);
  let ordinaryPanes = collectPaneNodes(root, explorerPaneId);
  if (ordinaryPanes.length === 0) {
    root = withEmptyOrdinaryPane(root, explorerPaneId, createNodeId);
    ordinaryPanes = collectPaneNodes(root, explorerPaneId);
  }
  const firstPaneId = ordinaryPanes[0]?.id ?? null;
  const focusedOrdinary = ordinaryPanes.find((pane) => pane.id === snapshot.focusedPaneId);
  const landingPaneId = focusedOrdinary?.id ?? firstPaneId;

  const added = currentTabs.filter((tab) => !snapshotTabIds.has(tab.tabId));
  if (added.length > 0) {
    root = mapPanes(root, (pane) =>
      pane.id === landingPaneId ? rebuildPane(pane, [...paneTabs(pane), ...added]) : pane,
    );
  }

  // The first pane only survives as a last resort, when every pane came out empty.
  const anyTabs = collectPaneNodes(root, explorerPaneId).some((pane) => paneTabs(pane).length > 0);
  const pruned = pruneNode(root, anyTabs ? null : firstPaneId, explorerPaneId) ?? root;

  const survivingPanes = collectPaneNodes(pruned, explorerPaneId);
  const focusedPaneId =
    survivingPanes.find((pane) => pane.id === snapshot.focusedPaneId)?.id ??
    survivingPanes[0]?.id ??
    null;

  const parentTabIdByTabId = Object.fromEntries(
    Object.entries(snapshot.parentTabIdByTabId ?? {}).filter(
      ([child, parent]) => current.has(child) && current.has(parent),
    ),
  );
  return {
    root: pruned as WorkspaceLayout["root"],
    focusedPaneId,
    ...(Object.keys(parentTabIdByTabId).length > 0 ? { parentTabIdByTabId } : {}),
  };
}

/** Keeps only the size overrides that still describe a group of the same arity. */
export function pruneSplitSizes(
  layout: WorkspaceLayout,
  splitSizes: Record<string, number[]>,
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  const visit = (node: NodeInternal) => {
    if (node.kind === "pane") {
      return;
    }
    const sizes = splitSizes[node.group.id];
    if (sizes && sizes.length === node.group.children.length) {
      result[node.group.id] = sizes;
    }
    node.group.children.forEach(visit);
  };
  visit(asNode(layout.root));
  return result;
}

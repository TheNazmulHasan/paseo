/**
 * Pure helpers for the board screen (fork mod #13). Kept free of React and the stores so the
 * layout maths and the key mapping can be unit tested.
 */
import type { ArrangePreset, ArrangeViewport } from "@/arrange/types";
import type { BoardTabOrigin } from "@/boards/types";
import type {
  KeyboardActionDefinition,
  KeyboardActionId,
} from "@/keyboard/keyboard-action-dispatcher";
import type { SplitGroup, SplitNode, SplitPane } from "@/stores/workspace-layout-actions";
import { findAdjacentPane } from "@/utils/split-navigation";

export type BoardPaneDirection = "left" | "right" | "up" | "down";

export type BoardKeyCommand =
  | { kind: "arrange"; preset: ArrangePreset }
  | { kind: "watch" }
  | { kind: "restore" }
  | { kind: "equalize" }
  | { kind: "focus-pane"; direction: BoardPaneDirection }
  | { kind: "close-tab" }
  | { kind: "tab-relative"; delta: 1 | -1 }
  | { kind: "tab-index"; index: number };

/**
 * The dispatcher ids the board handler serves. The router sends BOARD_ROUTED_ACTION_IDS
 * (shortcut ids) and translates them to these before delivery, payload included.
 */
export const BOARD_HANDLED_ACTION_IDS = [
  "workspace.arrange.single",
  "workspace.arrange.columns2",
  "workspace.arrange.columns3",
  "workspace.arrange.grid",
  "workspace.arrange.watch",
  "workspace.arrange.restore",
  "workspace.arrange.equalize",
  "workspace.pane.focus.left",
  "workspace.pane.focus.right",
  "workspace.pane.focus.up",
  "workspace.pane.focus.down",
  "workspace.tab.close-current",
  "workspace.tab.navigate-relative",
  "workspace.tab.navigate-index",
] as const satisfies readonly KeyboardActionId[];

const PRESET_BY_ACTION_ID: Partial<Record<KeyboardActionId, ArrangePreset>> = {
  "workspace.arrange.single": "single",
  "workspace.arrange.columns2": "columns-2",
  "workspace.arrange.columns3": "columns-3",
  "workspace.arrange.grid": "grid",
};

const DIRECTION_BY_ACTION_ID: Partial<Record<KeyboardActionId, BoardPaneDirection>> = {
  "workspace.pane.focus.left": "left",
  "workspace.pane.focus.right": "right",
  "workspace.pane.focus.up": "up",
  "workspace.pane.focus.down": "down",
};

/** What a routed keyboard action means on a board. Null for actions a board does not handle. */
export function resolveBoardKeyCommand(action: KeyboardActionDefinition): BoardKeyCommand | null {
  const preset = PRESET_BY_ACTION_ID[action.id];
  if (preset) {
    return { kind: "arrange", preset };
  }
  const direction = DIRECTION_BY_ACTION_ID[action.id];
  if (direction) {
    return { kind: "focus-pane", direction };
  }
  switch (action.id) {
    case "workspace.arrange.watch":
      return { kind: "watch" };
    case "workspace.arrange.restore":
      return { kind: "restore" };
    case "workspace.arrange.equalize":
      return { kind: "equalize" };
    case "workspace.tab.close-current":
      return { kind: "close-tab" };
    case "workspace.tab.navigate-relative":
      return { kind: "tab-relative", delta: action.delta };
    case "workspace.tab.navigate-index":
      return { kind: "tab-index", index: action.index };
    default:
      return null;
  }
}

export function buildBoardRoute(boardId: string): string {
  return `/boards/${encodeURIComponent(boardId)}`;
}

export function boardWorkspaceKey(
  origin: Pick<BoardTabOrigin, "serverId" | "workspaceId">,
): string {
  return `${origin.serverId}:${origin.workspaceId}`;
}

/** The size to lay out into: the measured board area, or the window before the first layout. */
export function resolveBoardViewport(input: {
  measured: ArrangeViewport | null;
  windowSize: ArrangeViewport;
}): ArrangeViewport {
  const { measured, windowSize } = input;
  if (measured && measured.width > 0 && measured.height > 0) {
    return measured;
  }
  return windowSize;
}

export function isBoardNodeHidden(node: SplitNode): boolean {
  if (node.kind === "pane") {
    return node.pane.hidden === true;
  }
  return node.group.children.every(isBoardNodeHidden);
}

/** The board's own override for a group wins when it still fits the group's children. */
export function resolveBoardGroupSizes(
  group: SplitGroup,
  splitSizes: Record<string, number[]> | undefined,
): number[] {
  const override = splitSizes?.[group.id];
  return override && override.length === group.children.length ? override : group.sizes;
}

/**
 * Flex grow per child, renormalized over the visible children so a hidden pane gives its space
 * back. The stored sizes are never touched, so unhiding restores what the user dragged to.
 */
export function resolveBoardGroupFlex(children: SplitNode[], sizes: number[]): number[] {
  const visibleTotal = children.reduce(
    (total, child, index) => (isBoardNodeHidden(child) ? total : total + (sizes[index] ?? 1)),
    0,
  );
  if (visibleTotal <= 0) {
    return children.map(() => 0);
  }
  return children.map((child, index) =>
    isBoardNodeHidden(child) ? 0 : (sizes[index] ?? 1) / visibleTotal,
  );
}

export function findBoardPane(
  root: SplitNode,
  paneId: string | null | undefined,
): SplitPane | null {
  if (!paneId) {
    return null;
  }
  if (root.kind === "pane") {
    return root.pane.id === paneId ? root.pane : null;
  }
  for (const child of root.group.children) {
    const found = findBoardPane(child, paneId);
    if (found) {
      return found;
    }
  }
  return null;
}

export interface BoardVisibleAgents {
  serverId: string;
  agentIds: string[];
}

/**
 * The agents on screen, grouped by host (a view spans hosts): the active tab of every visible
 * pane, when that tab is an agent. Hosts and ids are sorted so equal sets compare equal.
 */
export function groupBoardVisibleAgents(
  root: SplitNode,
  origins: Record<string, BoardTabOrigin>,
): BoardVisibleAgents[] {
  const byServer = new Map<string, Set<string>>();
  const visit = (node: SplitNode): void => {
    if (node.kind === "group") {
      node.group.children.forEach(visit);
      return;
    }
    if (node.pane.hidden === true) {
      return;
    }
    const origin = origins[resolvePaneActiveTabId(node.pane) ?? ""];
    if (!origin || origin.agentId === undefined) {
      return;
    }
    const ids = byServer.get(origin.serverId) ?? new Set<string>();
    ids.add(origin.agentId);
    byServer.set(origin.serverId, ids);
  };
  visit(root);
  return [...byServer.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serverId, ids]) => ({ serverId, agentIds: [...ids].sort() }));
}

/** The tab a pane is showing: its focused tab when it is still open, else the first one. */
export function resolvePaneActiveTabId(pane: SplitPane | null): string | null {
  if (!pane) {
    return null;
  }
  if (pane.focusedTabId && pane.tabIds.includes(pane.focusedTabId)) {
    return pane.focusedTabId;
  }
  return pane.tabIds[0] ?? null;
}

export function resolveAdjacentBoardPaneId(
  root: SplitNode,
  focusedPaneId: string | null,
  direction: BoardPaneDirection,
): string | null {
  if (!focusedPaneId) {
    return null;
  }
  return findAdjacentPane(root, focusedPaneId, direction);
}

/** Only panes that are on screen (not hidden by an arrange preset) count as visible. */
export function countVisibleBoardTabs(root: SplitNode): number {
  if (root.kind === "pane") {
    return root.pane.hidden === true ? 0 : root.pane.tabIds.length;
  }
  return root.group.children.reduce((total, child) => total + countVisibleBoardTabs(child), 0);
}

/** A pane's tab ids, minus tabs that carry no origin (they cannot be mounted or switched to). */
export function resolveRenderableTabIds(
  pane: SplitPane | null,
  origins: Record<string, BoardTabOrigin>,
): string[] {
  return pane ? pane.tabIds.filter((tabId) => Boolean(origins[tabId])) : [];
}

/** Next/previous tab with wrap. A missing active tab counts as the first. */
export function resolveRelativeTabId(
  tabIds: readonly string[],
  activeTabId: string | null,
  delta: 1 | -1,
): string | null {
  if (tabIds.length === 0) {
    return null;
  }
  const currentIndex = activeTabId ? tabIds.indexOf(activeTabId) : -1;
  const fromIndex = currentIndex >= 0 ? currentIndex : 0;
  return tabIds[(fromIndex + delta + tabIds.length) % tabIds.length] ?? null;
}

/** The nth tab, 1-based like the shortcut digit. */
export function resolveIndexedTabId(tabIds: readonly string[], index: number): string | null {
  return tabIds[index - 1] ?? null;
}

export const BOARD_MRU_LIMIT = 30;

/** Move `tabId` to the front of a most-recently-used list. Same array when already first. */
export function recordBoardTabUse(
  mru: readonly string[],
  tabId: string,
  limit: number = BOARD_MRU_LIMIT,
): readonly string[] {
  if (mru[0] === tabId) {
    return mru;
  }
  return [tabId, ...mru.filter((id) => id !== tabId)].slice(0, limit);
}

/**
 * Rows for the recent-tabs switcher inside one board pane. Row 0 is the tab on screen, so a
 * single tap lands on the previously used one; then the pane's tabs most recently used first;
 * then any never-used tabs in strip order.
 */
export function orderBoardSwitcherTabIds(input: {
  tabIds: readonly string[];
  activeTabId: string | null;
  mru: readonly string[];
  limit: number;
}): string[] {
  const { tabIds, activeTabId, mru, limit } = input;
  const inPane = new Set(tabIds);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (tabId: string | null | undefined) => {
    if (!tabId || seen.has(tabId) || !inPane.has(tabId)) {
      return;
    }
    seen.add(tabId);
    ordered.push(tabId);
  };
  push(activeTabId);
  for (const tabId of mru) {
    push(tabId);
  }
  for (const tabId of tabIds) {
    push(tabId);
  }
  return ordered.slice(0, limit);
}

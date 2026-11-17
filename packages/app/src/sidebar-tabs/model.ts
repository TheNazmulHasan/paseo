// Sidebar tabs (fork mod): a workspace's sessions listed under its sidebar row, Arc style.
// Everything here is pure. The tab list is NOT a second source: it is the workspace screen's own
// pane model (`deriveWorkspacePaneState`) run over each visible pane, in tree order.
import type { BoardTabOrigin } from "@/boards/types";
import {
  findBoardPane,
  listVisibleBoardPaneIds,
  resolvePaneActiveTabId,
} from "@/boards/screen-helpers";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

/** One session line under a workspace row. */
export interface SidebarTabLine {
  tabId: string;
  paneId: string;
  descriptor: WorkspaceTabDescriptor;
  /** The tab on screen: the focused tab of the focused pane. */
  active: boolean;
}

/** The open/folded key of a view; workspaces use their own `serverId:workspaceId` key. */
export function boardSidebarTabsKey(boardId: string): string {
  return `board:${boardId}`;
}

/**
 * The workspace's tabs as the top tab bar lists them: each visible pane's tabs in pane order,
 * panes in tree order. `excludePaneId` is the Explorer sidebar's pane, which has its own panel
 * and no place in the tab bar. The active line is the focused pane's focused tab; when focus
 * sits on a pane that is not listed, the first listed pane stands in.
 */
export function listWorkspaceTabLines(input: {
  layout: WorkspaceLayout | null;
  excludePaneId?: string | null;
}): SidebarTabLine[] {
  const { layout } = input;
  if (!layout) {
    return [];
  }
  const allTabs = collectAllTabs(layout.root);
  const panes = collectAllPanes(layout.root).filter((pane) => pane.id !== input.excludePaneId);
  const activePaneId =
    panes.find((pane) => pane.id === layout.focusedPaneId)?.id ?? panes[0]?.id ?? null;
  return panes.flatMap((pane) => {
    const state = deriveWorkspacePaneState({ pane, tabs: allTabs });
    return state.tabs.map((tab) => ({
      tabId: tab.descriptor.tabId,
      paneId: pane.id,
      descriptor: tab.descriptor,
      active: pane.id === activePaneId && tab.descriptor.tabId === state.activeTabId,
    }));
  });
}

/** One pane of a view: where its shown session lives and which tab that is. */
export interface SidebarBoardPaneLine {
  paneId: string;
  origin: BoardTabOrigin | null;
  /** The pane's shown tab; null for an empty pane or one whose session has no origin. */
  descriptor: WorkspaceTabDescriptor | null;
  active: boolean;
}

/**
 * A view's panes, one line each, in tree order (hidden panes left out, like the view itself).
 * The shown tab is the pane's active one, the same rule the view's own pane strip uses.
 */
export function listBoardPaneLines(input: {
  layout: WorkspaceLayout;
  origins: Readonly<Record<string, BoardTabOrigin>>;
}): SidebarBoardPaneLine[] {
  const { layout, origins } = input;
  const allTabs = collectAllTabs(layout.root);
  const paneIds = listVisibleBoardPaneIds(layout.root);
  const activePaneId = paneIds.includes(layout.focusedPaneId ?? "")
    ? layout.focusedPaneId
    : (paneIds[0] ?? null);
  return paneIds.map((paneId) => {
    const pane = findBoardPane(layout.root, paneId);
    const tabId = resolvePaneActiveTabId(pane);
    const origin = tabId ? (origins[tabId] ?? null) : null;
    const descriptor =
      pane && tabId
        ? (deriveWorkspacePaneState({ pane, tabs: allTabs }).tabs.find(
            (tab) => tab.descriptor.tabId === tabId,
          )?.descriptor ?? null)
        : null;
    return { paneId, origin, descriptor, active: paneId === activePaneId };
  });
}

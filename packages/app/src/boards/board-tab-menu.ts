import {
  buildWorkspaceTabMenuEntries,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/**
 * Right-click menu of a Views tab. It is the workspace tab menu (`buildWorkspaceTabMenuEntries`)
 * with a Views host behind it, so the entries, order, labels and test ids stay in step with
 * workspace tabs. A view never holds terminals, so "Copy terminal id" has no handler here.
 */
export interface BoardTabMenuInput {
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  labels: WorkspaceTabMenuLabels;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => void;
  onCloseTabsBefore: (tabId: string) => void;
  onCloseTabsAfter: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
}

export function boardTabContextMenuTestId(tabId: string): string {
  return `board-tab-context-${tabId}`;
}

const NO_TERMINALS_IN_VIEWS = () => {};

// Riajul's per-agent settings modal lives in the workspace screen; a view has no host for it
// yet, so the entry is left out rather than shown dead.
const ENTRIES_NOT_IN_VIEWS = new Set(["agent-settings"]);

export function buildBoardTabMenuEntries(input: BoardTabMenuInput): WorkspaceTabMenuEntry[] {
  return buildWorkspaceTabMenuEntries({
    surface: "desktop",
    tab: input.tab,
    index: input.index,
    tabCount: input.tabCount,
    menuTestIDBase: boardTabContextMenuTestId(input.tab.tabId),
    onCopyResumeCommand: input.onCopyResumeCommand,
    onCopyAgentId: input.onCopyAgentId,
    onCopyTerminalId: NO_TERMINALS_IN_VIEWS,
    onCopyFilePath: input.onCopyFilePath,
    onReloadAgent: input.onReloadAgent,
    onRenameTab: input.onRenameTab,
    onCloseTab: input.onCloseTab,
    onCloseTabsBefore: input.onCloseTabsBefore,
    onCloseTabsAfter: input.onCloseTabsAfter,
    onCloseOtherTabs: input.onCloseOtherTabs,
    labels: input.labels,
  }).filter((entry) => !ENTRIES_NOT_IN_VIEWS.has(entry.key));
}

export type BoardTabCloseScope = "before" | "after" | "others";

/** The tabs a "close to the left / right / others" entry removes, from the pane's tab order. */
export function resolveBoardTabsToClose(
  paneTabIds: readonly string[],
  tabId: string,
  scope: BoardTabCloseScope,
): string[] {
  const index = paneTabIds.indexOf(tabId);
  if (index === -1) {
    return [];
  }
  if (scope === "before") {
    return paneTabIds.slice(0, index);
  }
  if (scope === "after") {
    return paneTabIds.slice(index + 1);
  }
  return paneTabIds.filter((id) => id !== tabId);
}

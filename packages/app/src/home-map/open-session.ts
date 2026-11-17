import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";

/** The id of the open tab that shows this agent, or null when the workspace has no such tab. */
export function findAgentTabId(
  tabs: readonly { tabId: string; target: WorkspaceTabTarget }[],
  agentId: string,
): string | null {
  const tab = tabs.find(
    (candidate) => candidate.target.kind === "agent" && candidate.target.agentId === agentId,
  );
  return tab ? tab.tabId : null;
}

/**
 * Opens a session exactly like a sidebar session line (`sidebar-tabs/tab-lines.tsx`): open the
 * workspace on that session's tab, then reveal the tab so its pane and tab are focused. A workspace
 * never opened on this device has no saved layout yet; the open itself then creates the tab.
 */
export function openHomeSession(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): void {
  const { serverId, workspaceId, agentId } = input;
  navigateToWorkspace({ serverId, workspaceId, target: { kind: "agent", agentId } });
  const workspaceKey = `${serverId}:${workspaceId}`;
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  const tabId = layout ? findAgentTabId(collectAllTabs(layout.root), agentId) : null;
  if (tabId) revealWorkspaceTab(workspaceKey, tabId);
}

/** Opens a workspace on the tab the app would pick (an agent that needs attention, else the last). */
export function openHomeWorkspace(input: { serverId: string; workspaceId: string }): void {
  navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
}

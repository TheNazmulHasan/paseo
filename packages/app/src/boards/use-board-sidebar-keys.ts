import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useGlobalExplorerOpen } from "@/stores/global-sidebars-store";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";

/**
 * Sidebar keys on a view. A workspace screen owns these for its own explorer; a view has no
 * workspace screen, so without this only the left sidebar reacted and the Files explorer
 * state drifted from what the user set. Both act on the same global state workspaces use.
 */
export function useBoardSidebarKeys(input: { boardId: string; enabled: boolean }): void {
  const [explorerOpen, setExplorerOpen] = useGlobalExplorerOpen();
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id === "sidebar.toggle.right") {
        setExplorerOpen(!explorerOpen);
        return true;
      }
      if (action.id !== "sidebar.toggle.both") {
        return false;
      }
      const panel = usePanelStore.getState();
      const agentListOpen = selectIsAgentListOpen(panel, { isCompact: false });
      // Either open → close both; both closed → open both (same rule as a workspace).
      const open = !(agentListOpen || explorerOpen);
      if (open) {
        panel.openAgentListForLayout({ isCompact: false });
      } else {
        panel.closeAgentListForLayout({ isCompact: false });
      }
      setExplorerOpen(open);
      return true;
    },
    [explorerOpen, setExplorerOpen],
  );
  useKeyboardActionHandler({
    handlerId: `board-sidebar-actions:${input.boardId}`,
    actions: ["sidebar.toggle.right", "sidebar.toggle.both"] as const,
    enabled: input.enabled,
    priority: 100,
    isActive: () => true,
    handle,
  });
}

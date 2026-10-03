import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { getBoard, setBoardExplorerOpen } from "@/boards/controller";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";

/**
 * Sidebar keys on a view. A workspace screen owns these for its own explorer; a view has no
 * workspace screen, so without this only the left sidebar reacted and the Files explorer
 * state drifted from what the user set. The explorer state is the view's own (board.explorerOpen).
 */
export function useBoardSidebarKeys(input: { boardId: string; enabled: boolean }): void {
  const { boardId } = input;
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      const explorerOpen = Boolean(getBoard(boardId)?.explorerOpen);
      if (action.id === "sidebar.toggle.right") {
        setBoardExplorerOpen(boardId, !explorerOpen);
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
      setBoardExplorerOpen(boardId, open);
      return true;
    },
    [boardId],
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

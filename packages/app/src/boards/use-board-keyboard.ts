import { useCallback } from "react";
import type { ArrangeViewport } from "@/arrange/types";
import {
  arrangeBoard,
  equalizeBoardPanes,
  focusBoardPane,
  refreshLiveBoard,
  removeBoardTab,
  restoreBoardArrangement,
  selectBoardTab,
} from "@/boards/controller";
import { boardKeyboardHandlerId } from "@/boards/keyboard-contract";
import {
  BOARD_HANDLED_ACTION_IDS,
  findBoardPane,
  resolveAdjacentBoardPaneId,
  resolveBoardKeyCommand,
  resolveIndexedTabId,
  resolvePaneActiveTabId,
  resolveRelativeTabId,
  resolveRenderableTabIds,
} from "@/boards/screen-helpers";
import type { Board } from "@/boards/types";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";

/** Same priority a workspace's own handlers use; only one of the two screens is ever focused. */
const BOARD_HANDLER_PRIORITY = 100;

interface UseBoardKeyboardInput {
  board: Board;
  /** True while the board route is the focused screen. */
  enabled: boolean;
  getViewport: () => ArrangeViewport;
}

/**
 * Registers the one handler that serves every action the keyboard router sends to a board route
 * (BOARD_ROUTED_ACTION_IDS): arrange presets, restore, equalize, pane focus, close tab, and
 * next/previous/nth tab inside the focused pane.
 */
export function useBoardKeyboard({ board, enabled, getViewport }: UseBoardKeyboardInput) {
  const boardId = board.id;
  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      const command = resolveBoardKeyCommand(action);
      if (!command) {
        return false;
      }
      const focusedPane = findBoardPane(board.layout.root, board.layout.focusedPaneId);
      const activeTabId = resolvePaneActiveTabId(focusedPane);
      switch (command.kind) {
        case "arrange":
          arrangeBoard({ boardId, preset: command.preset, viewport: getViewport() });
          return true;
        case "watch":
          if (board.kind === "live") {
            refreshLiveBoard(getViewport());
          } else {
            arrangeBoard({ boardId, preset: "grid", viewport: getViewport() });
          }
          return true;
        case "restore":
          restoreBoardArrangement(boardId);
          return true;
        case "equalize":
          equalizeBoardPanes(boardId);
          return true;
        case "focus-pane": {
          const nextPaneId = resolveAdjacentBoardPaneId(
            board.layout.root,
            board.layout.focusedPaneId,
            command.direction,
          );
          if (nextPaneId) {
            focusBoardPane(boardId, nextPaneId);
          }
          return true;
        }
        case "close-tab":
          if (activeTabId) {
            removeBoardTab(boardId, activeTabId);
          }
          return true;
        case "tab-relative":
        case "tab-index": {
          if (!focusedPane) {
            return true;
          }
          const tabIds = resolveRenderableTabIds(focusedPane, board.origins);
          const nextTabId =
            command.kind === "tab-relative"
              ? resolveRelativeTabId(tabIds, activeTabId, command.delta)
              : resolveIndexedTabId(tabIds, command.index);
          if (nextTabId) {
            selectBoardTab(boardId, focusedPane.id, nextTabId);
          }
          return true;
        }
      }
    },
    [
      board.kind,
      board.layout.focusedPaneId,
      board.layout.root,
      board.origins,
      boardId,
      getViewport,
    ],
  );

  useKeyboardActionHandler({
    handlerId: boardKeyboardHandlerId(boardId),
    actions: BOARD_HANDLED_ACTION_IDS,
    enabled,
    priority: BOARD_HANDLER_PRIORITY,
    isActive: () => true,
    handle,
  });
}

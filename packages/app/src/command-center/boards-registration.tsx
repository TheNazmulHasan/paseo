import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SquareSplitHorizontal, LayoutGrid, Radio } from "lucide-react-native";
import { getIsElectron } from "@/constants/platform";
import { useBoards } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { buildBoardsCommandCenterContributions } from "./boards-contributions";
import { getCommandCenterIcon } from "./icon";
import { useCommandCenterActions } from "./provider";

const SPLIT_ICON = getCommandCenterIcon(SquareSplitHorizontal);
const LIVE_ICON = getCommandCenterIcon(Radio);
const VIEW_ICON = getCommandCenterIcon(LayoutGrid);

/** Registers the Views entries in the Command Center. Mounted once, by BoardsHost. */
export function useBoardsCommandCenterActions(): void {
  const { t } = useTranslation();
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const { overrides } = useKeyboardShortcutOverrides();
  const views = useBoards();

  const actions = useMemo(
    () =>
      buildBoardsCommandCenterContributions({
        labels: {
          section: t("boards.sidebar.title"),
          split: t("boards.menu.splitWorkspaces"),
          openLive: t("boards.menu.openLive"),
          openView: (name) => t("boards.menu.openView", { name }),
        },
        icons: { split: SPLIT_ICON, live: LIVE_ICON, view: VIEW_ICON },
        shortcuts: {
          split:
            resolveShortcutKeysForAction("workspace-board-split", overrides, {
              isMac: getShortcutOs() === "mac",
              isDesktop: getIsElectron(),
            }) ?? undefined,
        },
        views,
        openSplitPicker: () => {
          clearCommandCenterFocusRestoreElement();
          keyboardActionDispatcher.dispatch({ id: "workspace.board.split", scope: "sidebar" });
        },
        openView: (boardId) => {
          clearCommandCenterFocusRestoreElement();
          navigateToBoard(boardId);
        },
      }),
    [keyboardActionDispatcher, overrides, t, views],
  );

  useCommandCenterActions({ sourceId: "boards", enabled: true, actions });
}

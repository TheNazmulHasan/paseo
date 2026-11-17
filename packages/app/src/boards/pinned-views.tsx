import { memo } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { SquareSplitHorizontal } from "lucide-react-native";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { ViewRow, useViewRowActions } from "@/boards/boards-section";
import { useBoards } from "@/boards/controller";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { openSplitPicker } from "@/boards/split-picker-store";
import { isViewActive, pinnedSectionCount } from "@/boards/views-model";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";

/**
 * The saved views, in the order the store keeps them.
 * Views are one part of the Pinned section: the section's count, fold and new-view icon all
 * live on the Pinned header (`PinnedSectionHeader`), and these rows come before the pinned
 * workspaces.
 */
function usePinnedViewRows() {
  return useBoards();
}

/** True while there is at least one saved view, so the Pinned section shows with nothing pinned. */
export function usePinnedViewsPresent(): boolean {
  return usePinnedViewRows().length > 0;
}

/**
 * The always-visible new-view (split) icon. It sits on the Pinned header while that section is
 * showing, and on the Folders header when it is not (no view and nothing pinned), so a first view
 * can always be made from the sidebar.
 */
export function NewViewButton() {
  const { t } = useTranslation();
  const splitKeys = useShortcutKeys("workspace-board-split");
  return (
    <DeskIconButton
      icon={SquareSplitHorizontal}
      label={t("boards.sidebar.split")}
      shortcutKeys={splitKeys}
      onPress={openSplitPicker}
      testID="sidebar-views-split"
    />
  );
}

/**
 * The header of the Pinned section, which holds the views and the pinned workspaces: one title, one
 * count (views plus pinned workspaces), one fold, and the always-visible new-view (split) icon.
 */
export function PinnedSectionHeader({
  pinnedCount,
  collapsed,
  onToggle,
  testID,
  countTestID,
}: {
  pinnedCount: number;
  collapsed: boolean;
  onToggle: () => void;
  testID: string;
  countTestID: string;
}) {
  const { t } = useTranslation();
  const rows = usePinnedViewRows();
  return (
    <SidebarSectionHeader
      title={t("sidebar.pinned.title")}
      collapsed={collapsed}
      onToggle={onToggle}
      testID={testID}
      count={pinnedSectionCount(rows.length, pinnedCount)}
      countTestID={countTestID}
      chevronAlwaysVisible
    >
      <NewViewButton />
    </SidebarSectionHeader>
  );
}

/**
 * The view rows at the top of the Pinned section, the same rows the Views section had: open, rename in place, delete after a confirm, and the folder icon. Rendered only
 * while the section is open. `onWorkspacePress` closes the compact sidebar after a row opens.
 */
export const PinnedViewRows = memo(function PinnedViewRows({
  onWorkspacePress,
}: {
  onWorkspacePress?: () => void;
}) {
  const rows = usePinnedViewRows();
  const pathname = usePathname();
  const activeBoardId = parseBoardIdFromPathname(pathname);
  const { editingId, onStartRename, onOpen, onCancelRename, onCommitRename, onDelete } =
    useViewRowActions({ boards: rows, onWorkspacePress });
  return (
    <>
      {rows.map((board) => (
        <ViewRow
          key={board.id}
          board={board}
          active={isViewActive(activeBoardId, board.id)}
          editing={editingId === board.id}
          onOpen={onOpen}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
          onCommitRename={onCommitRename}
          onDelete={onDelete}
        />
      ))}
    </>
  );
});

import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LayoutGrid, Pencil, Trash2 } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { BoardFolderButton } from "@/folders/folder-row-button";
import { deleteBoard, renameBoard } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { ViewRenameField } from "@/boards/view-rename-field";
import { LIVE_BOARD_ID, type BoardSummary } from "@/boards/types";
import { resolveRename, showRowActions } from "@/boards/views-model";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedLayoutGrid = withUnistyles(LayoutGrid);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ROW_ICON_SIZE = 14;

interface ViewRowProps {
  board: BoardSummary;
  active: boolean;
  editing: boolean;
  onOpen: (boardId: string) => void;
  onStartRename: (boardId: string) => void;
  onCancelRename: () => void;
  onCommitRename: (boardId: string, name: string) => void;
  onDelete: (board: BoardSummary) => void;
}

export const ViewRow = memo(function ViewRow({
  board,
  active,
  editing,
  onOpen,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onDelete,
}: ViewRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const isLive = board.id === LIVE_BOARD_ID || board.kind === "live";
  const canHover = isWeb && !isCompact;
  const handleOpen = useCallback(() => onOpen(board.id), [board.id, onOpen]);
  const handleStartRename = useCallback(() => onStartRename(board.id), [board.id, onStartRename]);
  const handleCommit = useCallback(
    (name: string) => onCommitRename(board.id, name),
    [board.id, onCommitRename],
  );
  const handleDelete = useCallback(() => onDelete(board), [board, onDelete]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      active && styles.rowActive,
      pressed && styles.rowPressed,
    ],
    [active],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const label = isLive ? t("boards.sidebar.live") : board.name;

  if (editing && !isLive) {
    // Not a Pressable while renaming: inside the pressable row a click in the box also opened
    // the view (and its panes took the focus), and the box lost what was typed.
    return (
      <View
        style={[styles.row, active && styles.rowActive]}
        testID={`sidebar-view-row-${board.id}`}
      >
        <ThemedLayoutGrid size={ROW_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
        <View style={styles.nameSlot}>
          <ViewRenameField
            initialValue={board.name}
            placeholder={t("boards.sidebar.namePlaceholder")}
            onCommit={handleCommit}
            onCancel={onCancelRename}
          />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={rowStyle}
      onPress={handleOpen}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      testID={`sidebar-view-row-${board.id}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          {isLive ? (
            <View style={styles.liveDot} testID="sidebar-view-live-dot" />
          ) : (
            <ThemedLayoutGrid size={ROW_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
          )}
          <Text style={styles.name} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.count} testID={`sidebar-view-count-${board.id}`}>
            {board.sessionCount}
          </Text>
          {isLive ? null : <BoardFolderButton boardId={board.id} />}
          {!isLive && showRowActions({ active, hovered: Boolean(hovered), canHover }) ? (
            <View style={styles.rowActions}>
              <DeskIconButton
                icon={Pencil}
                label={t("boards.sidebar.rename")}
                onPress={handleStartRename}
                testID={`sidebar-view-rename-${board.id}`}
              />
              <DeskIconButton
                icon={Trash2}
                label={t("boards.sidebar.delete")}
                onPress={handleDelete}
                testID={`sidebar-view-delete-${board.id}`}
              />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
});

/**
 * What a view row does: open, rename in place, delete after a confirm. Shared by the Pinned section
 * (which lists the views) and the folders that hold views, so a view behaves the same wherever it
 * is listed.
 */
export function useViewRowActions({
  boards,
  onWorkspacePress,
}: {
  boards: readonly BoardSummary[];
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const handleOpen = useCallback(
    (boardId: string) => {
      navigateToBoard(boardId);
      onWorkspacePress?.();
    },
    [onWorkspacePress],
  );
  const handleCancelRename = useCallback(() => setEditingId(null), []);
  const handleCommitRename = useCallback(
    (boardId: string, name: string) => {
      const current = boards.find((row) => row.id === boardId)?.name ?? "";
      const next = resolveRename(current, name);
      if (next) {
        renameBoard(boardId, next);
      }
      setEditingId(null);
    },
    [boards],
  );
  const handleDelete = useCallback(
    (board: BoardSummary) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("boards.sidebar.deleteTitle"),
          message: t("boards.sidebar.deleteMessage", { name: board.name }),
          confirmLabel: t("boards.sidebar.delete"),
          destructive: true,
        });
        if (confirmed) {
          deleteBoard(board.id);
        }
      })();
    },
    [t],
  );
  return {
    editingId,
    onStartRename: setEditingId,
    onOpen: handleOpen,
    onCancelRename: handleCancelRename,
    onCommitRename: handleCommitRename,
    onDelete: handleDelete,
  };
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  rowActive: { backgroundColor: theme.colors.surfaceSidebarSelected },
  liveDot: {
    width: 8,
    height: 8,
    marginHorizontal: 3,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.success,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  nameSlot: { flex: 1, minWidth: 0 },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));

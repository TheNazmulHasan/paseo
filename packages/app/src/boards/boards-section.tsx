import { memo, useCallback, useMemo, useState } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  ChevronRight,
  SquareSplitHorizontal,
  LayoutGrid,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { deleteBoard, renameBoard, useBoards } from "@/boards/controller";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { navigateToBoard } from "@/boards/navigation";
import { useViewsSidebarStore } from "@/boards/sidebar-store";
import { ViewRenameField } from "@/boards/view-rename-field";
import { openSplitPicker } from "@/boards/split-picker-store";
import { LIVE_BOARD_ID, type BoardSummary } from "@/boards/types";
import { isViewActive, orderViewRows, resolveRename, showRowActions } from "@/boards/views-model";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
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

const ViewRow = memo(function ViewRow({
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
 * The sidebar's Views section, between Pinned and the Desk: the Live view first, then the saved
 * split views. Reads its own data, so the two sidebar lists that render it pass nothing but
 * `onWorkspacePress` (called after a row opens, so the compact sidebar can close).
 */
export function BoardsSection({ onWorkspacePress }: { onWorkspacePress?: () => void }) {
  const { t } = useTranslation();
  const boards = useBoards();
  const pathname = usePathname();
  const activeBoardId = parseBoardIdFromPathname(pathname);
  const collapsed = useViewsSidebarStore((state) => state.collapsed);
  const toggleCollapsed = useViewsSidebarStore((state) => state.toggleCollapsed);
  const splitKeys = useShortcutKeys("workspace-board-split");
  const [editingId, setEditingId] = useState<string | null>(null);
  const rows = useMemo(() => orderViewRows(boards), [boards]);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;

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
      const current = rows.find((row) => row.id === boardId)?.name ?? "";
      const next = resolveRename(current, name);
      if (next) {
        renameBoard(boardId, next);
      }
      setEditingId(null);
    },
    [rows],
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

  return (
    <View style={styles.section} testID="sidebar-views-section">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          onPress={toggleCollapsed}
          style={styles.titleGroup}
          testID="sidebar-views-header"
        >
          <Chevron size={12} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.title} numberOfLines={1}>
            {t("boards.sidebar.title")}
          </Text>
          <Text style={styles.headerCount} testID="sidebar-views-count">
            {rows.length}
          </Text>
        </Pressable>
        <DeskIconButton
          icon={SquareSplitHorizontal}
          label={t("boards.sidebar.split")}
          shortcutKeys={splitKeys}
          onPress={openSplitPicker}
          testID="sidebar-views-split"
        />
      </View>
      {collapsed
        ? null
        : rows.map((board) => (
            <ViewRow
              key={board.id}
              board={board}
              active={isViewActive(activeBoardId, board.id)}
              editing={editingId === board.id}
              onOpen={handleOpen}
              onStartRename={setEditingId}
              onCancelRename={handleCancelRename}
              onCommitRename={handleCommitRename}
              onDelete={handleDelete}
            />
          ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
    paddingVertical: theme.spacing[1],
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
    userSelect: "none",
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  headerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.7,
  },
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

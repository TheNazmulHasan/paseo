import { memo, useCallback, useMemo } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { focusBoardPane, useBoard } from "@/boards/controller";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { navigateToBoard } from "@/boards/navigation";
import { useBoardWorkspaceIdentities } from "@/boards/use-board-workspace-identity";
import { boardWorkspaceKey } from "@/boards/screen-helpers";
import { PressHighlight } from "@/components/ui/press-highlight";
import { DeskIconButton } from "@/desk/desk-icon-button";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import {
  boardSidebarTabsKey,
  listBoardPaneLines,
  listWorkspaceTabLines,
  type SidebarBoardPaneLine,
  type SidebarTabLine,
} from "@/sidebar-tabs/model";
import { useIsSidebarTabsOpen, useSidebarTabsStore } from "@/sidebar-tabs/open-store";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import {
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";

const LINE_ICON_SIZE = 14;

/**
 * The always-visible chevron at the left edge of a workspace or view row: it folds and unfolds the
 * row's session list. Open or folded is remembered per row on this device.
 */
export const SidebarTabsChevron = memo(function SidebarTabsChevron({
  stateKey,
  testID,
}: {
  stateKey: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const open = useIsSidebarTabsOpen(stateKey);
  const toggle = useSidebarTabsStore((state) => state.toggle);
  const handlePress = useCallback(() => toggle(stateKey), [stateKey, toggle]);
  return (
    <DeskIconButton
      icon={open ? ChevronDown : ChevronRight}
      label={open ? t("sidebarTabs.hide") : t("sidebarTabs.show")}
      onPress={handlePress}
      testID={testID}
      size={12}
    />
  );
});

/**
 * One session line: the tab's own icon (provider, terminal, file ...) with the status signal the
 * tab strip draws on it, then the full title on one line, cut only at the sidebar's edge. There is
 * no close button and nothing that needs hover.
 */
function SidebarTabLineView({
  presentation,
  prefix,
  active,
  onPress,
  testID,
}: {
  presentation: WorkspaceTabPresentation;
  /** A view's pane line leads with the workspace name: "api · Fix the build". */
  prefix?: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const title =
    presentation.titleState === "loading" ? t("workspace.tabs.loading") : presentation.label;
  const text = prefix ? `${prefix} · ${title}` : title;
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.line,
      Boolean(hovered) && styles.lineHovered,
      active && styles.lineActive,
      pressed && styles.linePressed,
    ],
    [active],
  );
  return (
    <PressHighlight
      style={style}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <View style={styles.lineIcon}>
        <WorkspaceTabIcon
          presentation={presentation}
          active={active}
          size={LINE_ICON_SIZE}
          backdrop={active ? "surfaceSidebarSelected" : "surfaceSidebar"}
        />
      </View>
      <Text style={active ? styles.titleActive : styles.title} numberOfLines={1}>
        {text}
      </Text>
    </PressHighlight>
  );
}

function SidebarTabsHint({ children, testID }: { children: string; testID?: string }) {
  return (
    <Text style={styles.hint} testID={testID}>
      {children}
    </Text>
  );
}

const WorkspaceTabLineItem = memo(function WorkspaceTabLineItem({
  line,
  serverId,
  workspaceId,
  workspaceKey,
  onScreen,
}: {
  line: SidebarTabLine;
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  onScreen: boolean;
}) {
  const { descriptor, tabId } = line;
  const active = onScreen && line.active;
  const handlePress = useCallback(() => {
    // Open the workspace with exactly this tab focused. The target goes through the normal open
    // path (it finds the existing tab); revealing by id then settles pane and tab.
    navigateToWorkspace({ serverId, workspaceId, target: descriptor.target });
    revealWorkspaceTab(workspaceKey, tabId);
  }, [descriptor.target, serverId, tabId, workspaceId, workspaceKey]);
  const render = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <SidebarTabLineView
        presentation={presentation}
        active={active}
        onPress={handlePress}
        testID={`sidebar-tab-line-${workspaceKey}-${tabId}`}
      />
    ),
    [active, handlePress, tabId, workspaceKey],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={descriptor}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {render}
    </WorkspaceTabPresentationResolver>
  );
});

function WorkspaceTabLinesOpen({
  serverId,
  workspaceId,
  workspaceKey,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}) {
  const { t } = useTranslation();
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[workspaceKey] ?? null);
  const explorerPaneId = useWorkspaceLayoutStore((state) =>
    selectExplorerSidebarPaneId(state, workspaceKey),
  );
  const selection = useActiveWorkspaceSelection();
  const onScreen = selection?.serverId === serverId && selection?.workspaceId === workspaceId;
  const lines = useMemo(
    () => listWorkspaceTabLines({ layout, excludePaneId: explorerPaneId }),
    [explorerPaneId, layout],
  );
  return (
    <View style={styles.lines} testID={`sidebar-tabs-${workspaceKey}`}>
      {lines.length === 0 ? (
        <SidebarTabsHint testID={`sidebar-tabs-empty-${workspaceKey}`}>
          {t("sidebarTabs.none")}
        </SidebarTabsHint>
      ) : (
        lines.map((line) => (
          <WorkspaceTabLineItem
            key={line.tabId}
            line={line}
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceKey={workspaceKey}
            onScreen={onScreen}
          />
        ))
      )}
    </View>
  );
}

/**
 * The sessions of one workspace, stacked under its row in the order of its top tab bar. Renders
 * nothing while the row is folded. The workspace's own layout is the only source: the tab strip
 * and this list can never disagree.
 */
export const WorkspaceTabLines = memo(function WorkspaceTabLines({
  serverId,
  workspaceId,
  workspaceKey,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}) {
  const open = useIsSidebarTabsOpen(workspaceKey);
  if (!open) {
    return null;
  }
  return (
    <WorkspaceTabLinesOpen
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceKey={workspaceKey}
    />
  );
});

const BoardPaneLineItem = memo(function BoardPaneLineItem({
  boardId,
  line,
  workspaceName,
  onScreen,
}: {
  boardId: string;
  line: SidebarBoardPaneLine;
  workspaceName: string;
  onScreen: boolean;
}) {
  const { t } = useTranslation();
  const { paneId, origin, descriptor } = line;
  const active = onScreen && line.active;
  const handlePress = useCallback(() => {
    focusBoardPane(boardId, paneId);
    navigateToBoard(boardId);
  }, [boardId, paneId]);
  const render = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <SidebarTabLineView
        presentation={presentation}
        prefix={workspaceName}
        active={active}
        onPress={handlePress}
        testID={`sidebar-pane-line-${boardId}-${paneId}`}
      />
    ),
    [active, boardId, handlePress, paneId, workspaceName],
  );
  if (!descriptor || !origin) {
    return (
      <PressHighlight
        style={active ? styles.lineEmptyActive : styles.line}
        onPress={handlePress}
        accessibilityRole="button"
        testID={`sidebar-pane-line-${boardId}-${paneId}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          {t("sidebarTabs.emptyPane")}
        </Text>
      </PressHighlight>
    );
  }
  return (
    <WorkspaceTabPresentationResolver
      tab={descriptor}
      serverId={origin.serverId}
      workspaceId={origin.workspaceId}
    >
      {render}
    </WorkspaceTabPresentationResolver>
  );
});

function ViewPaneLinesOpen({ boardId }: { boardId: string }) {
  const board = useBoard(boardId);
  const identities = useBoardWorkspaceIdentities();
  const pathname = usePathname();
  const onScreen = parseBoardIdFromPathname(pathname) === boardId;
  const layout = board?.layout ?? null;
  const origins = board?.origins ?? null;
  const lines = useMemo(
    () => (layout && origins ? listBoardPaneLines({ layout, origins }) : []),
    [layout, origins],
  );
  return (
    <View style={styles.lines} testID={`sidebar-panes-${boardId}`}>
      {lines.map((line) => (
        <BoardPaneLineItem
          key={line.paneId}
          boardId={boardId}
          line={line}
          workspaceName={
            line.origin ? (identities.get(boardWorkspaceKey(line.origin))?.workspaceName ?? "") : ""
          }
          onScreen={onScreen}
        />
      ))}
    </View>
  );
}

/**
 * A view's panes, one line each: "workspace name · the pane's active tab". A click focuses that
 * pane. One level only: sessions inside a pane are not listed, so the list stays short.
 */
export const ViewPaneLines = memo(function ViewPaneLines({ boardId }: { boardId: string }) {
  const open = useIsSidebarTabsOpen(boardSidebarTabsKey(boardId));
  if (!open) {
    return null;
  }
  return <ViewPaneLinesOpen boardId={boardId} />;
});

const styles = StyleSheet.create((theme) => ({
  lines: {
    // Aligns the line icon under the row's own status indicator: row padding, chevron, gap.
    paddingLeft: theme.spacing[8] + theme.spacing[1],
    paddingRight: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  line: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    userSelect: "none",
  },
  lineHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  lineActive: { backgroundColor: theme.colors.surfaceSidebarSelected },
  lineEmptyActive: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  linePressed: { backgroundColor: theme.colors.surface2 },
  lineIcon: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  titleActive: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[1],
  },
}));

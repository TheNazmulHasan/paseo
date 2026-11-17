import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, Text, View } from "react-native";
import { Bookmark, BrushCleaning, ListChecks } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { addWorkspacesToBoard, replaceBoardWorkspaces, splitWorkspaces } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { resolveSplitViewport } from "@/boards/workspace-picker-model";
import { isWeb } from "@/constants/platform";
import { DeskGroupingMenu } from "@/desk/desk-grouping-menu";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { DeskSelectableRow } from "@/desk/desk-selectable-row";
import { DeskSelectionBar } from "@/desk/desk-selection-bar";
import { useDeskSelectionStore } from "@/desk/desk-selection-store";
import { useDeskStore } from "@/desk/desk-store";
import { useDeskTargetView } from "@/desk/target-view";
import {
  availableDeskGroupings,
  resolveDeskGrouping,
  type DeskGroup,
  type DeskGrouping,
} from "@/desk/model";
import { useClearDesk } from "@/desk/use-clear-desk";
import {
  FolderBlockFrame,
  FolderHeaderFrame,
  FolderHint,
  FolderRowsFrame,
} from "@/folders/folder-row-frame";
import { useFoldersAvailable } from "@/folders/use-folder-actions";
import { useAppSettings } from "@/hooks/use-settings";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import { shouldShowSidebarHostLabels } from "@/hooks/use-sidebar-workspaces-list";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

const ThemedBookmark = withUnistyles(Bookmark);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const EMPTY_SHORTCUT_INDEX = new Map<string, number>();
const deskLead = <ThemedBookmark size={14} uniProps={mutedMapping} />;
const GROUPING_LABEL_KEYS = {
  recent: "sidebar.desk.groupRecent",
  project: "sidebar.desk.groupProject",
  status: "sidebar.desk.groupStatus",
  folder: "sidebar.desk.groupFolder",
} as const satisfies Record<DeskGrouping, string>;

/**
 * The Desk, as the first folder in the Folders section: the working set. It looks and folds like
 * a user folder (its own fold state, open by default) but is built in: no rename, no delete, no
 * reorder, and never offered in the folder picker. Rows are the sidebar's own workspace row (status
 * indicator, attention, menus and all); only their grouping is the Desk's.
 *
 * Reads the sidebar model and wires its own row dependencies, so the Folders body passes nothing
 * but `onWorkspacePress`.
 */
export function DeskFolder({ onWorkspacePress }: { onWorkspacePress?: () => void }) {
  const { t } = useTranslation();
  const { deskGroups, shelfCount, projects, projectIconTargets, shortcutModel } = useSidebarModel();
  const storedGrouping = useDeskStore((state) => state.deskGrouping);
  const foldersAvailable = useFoldersAvailable();
  // The Folder grouping only exists while folders do; without them the sidebar shows Recent.
  const deskGrouping = resolveDeskGrouping(storedGrouping, foldersAvailable);
  const setDeskGrouping = useDeskStore((state) => state.setDeskGrouping);
  const collapsed = useDeskStore((state) => state.deskCollapsed);
  const toggleCollapsed = useDeskStore((state) => state.toggleDeskCollapsed);
  const clearDesk = useClearDesk(deskGroups);
  const hosts = useHosts();
  const rowItems = useSidebarRowItems();
  const {
    settings: { sidebarIdentityIcon },
  } = useAppSettings();
  const hostBadgeByServerId = useHostBadges({
    enabled: rowItems.host && shouldShowSidebarHostLabels(projects),
    showIcon: sidebarIdentityIcon,
  });
  const projectIconByProjectViewKey = useProjectIcons({ projects: projectIconTargets });
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsPinningByServerId = useHostFeatureMap(serverIds, "workspacePinning");
  const onToggleWorkspacePin = useSidebarWorkspacePinController();
  const showShortcutBadges = useShowShortcutBadges();
  const shortcutIndex = showShortcutBadges
    ? shortcutModel.shortcutIndexByWorkspaceKey
    : EMPTY_SHORTCUT_INDEX;

  const count = useMemo(
    () => deskGroups.reduce((total, group) => total + group.rows.length, 0),
    [deskGroups],
  );

  const selectionActive = useDeskSelectionStore((state) => state.active);
  const checked = useDeskSelectionStore((state) => state.checked);
  const toggleSelectionMode = useDeskSelectionStore((state) => state.toggleMode);
  const exitSelection = useDeskSelectionStore((state) => state.exit);
  const toggleChecked = useDeskSelectionStore((state) => state.toggle);
  const pruneSelection = useDeskSelectionStore((state) => state.prune);
  const deskWorkspaces = useMemo(() => {
    const byKey = new Map<string, { serverId: string; workspaceId: string }>();
    for (const group of deskGroups) {
      for (const row of group.rows) {
        byKey.set(row.workspaceKey, { serverId: row.serverId, workspaceId: row.workspaceId });
      }
    }
    return byKey;
  }, [deskGroups]);
  useEffect(() => {
    pruneSelection(new Set(deskWorkspaces.keys()));
  }, [deskWorkspaces, pruneSelection]);
  useEffect(() => {
    if (!selectionActive || !isWeb || typeof window === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitSelection, selectionActive]);
  const createView = useCallback(
    (layout: "columns" | "grid") => {
      const chosen = checked.flatMap((key) => {
        const ref = deskWorkspaces.get(key);
        return ref ? [ref] : [];
      });
      if (chosen.length < 2) return;
      const { width, height } = Dimensions.get("window");
      const boardId = splitWorkspaces({
        workspaces: chosen,
        layout,
        viewport: resolveSplitViewport({ measured: null, windowSize: { width, height } }),
      });
      exitSelection();
      if (boardId) navigateToBoard(boardId);
    },
    [checked, deskWorkspaces, exitSelection],
  );
  const handleColumns = useCallback(() => createView("columns"), [createView]);
  const handleGrid = useCallback(() => createView("grid"), [createView]);
  const targetView = useDeskTargetView();
  const targetViewId = targetView?.id ?? null;
  const fillTargetView = useCallback(
    (mode: "add" | "replace") => {
      if (!targetViewId) return;
      const chosen = checked.flatMap((key) => {
        const ref = deskWorkspaces.get(key);
        return ref ? [ref] : [];
      });
      if (chosen.length === 0) return;
      const { width, height } = Dimensions.get("window");
      const viewport = resolveSplitViewport({ measured: null, windowSize: { width, height } });
      if (mode === "add") {
        addWorkspacesToBoard(targetViewId, chosen, viewport);
      } else {
        replaceBoardWorkspaces(targetViewId, chosen, viewport);
      }
      exitSelection();
      navigateToBoard(targetViewId);
    },
    [checked, deskWorkspaces, exitSelection, targetViewId],
  );
  const handleAddToView = useCallback(() => fillTargetView("add"), [fillTargetView]);
  const handleReplaceView = useCallback(() => fillTargetView("replace"), [fillTargetView]);
  const groupingOptions = useMemo(
    () =>
      availableDeskGroupings(foldersAvailable).map((value) => ({
        value,
        label: t(GROUPING_LABEL_KEYS[value]),
        testID: `desk-group-${value}`,
      })),
    [foldersAvailable, t],
  );
  const handleGroupingChange = useCallback(
    (grouping: DeskGrouping) => setDeskGrouping(grouping),
    [setDeskGrouping],
  );

  const showEmpty = !collapsed && deskGroups.length === 0;
  const showGroups = !collapsed && deskGroups.length > 0;

  // Without folders a sidebar with no workspaces yet has nothing to sort into Desk or Shelf. With
  // folders the Desk is always the first folder, even empty: it is app-local, not on any host.
  if (!foldersAvailable && count === 0 && shelfCount === 0) {
    return null;
  }

  const actions = (
    <>
      <DeskGroupingMenu
        options={groupingOptions}
        value={deskGrouping}
        onChange={handleGroupingChange}
      />
      <DeskIconButton
        icon={ListChecks}
        label={t("sidebar.desk.select")}
        onPress={toggleSelectionMode}
        testID="sidebar-desk-select"
      />
      <DeskIconButton
        icon={BrushCleaning}
        label={t("sidebar.desk.clear")}
        onPress={clearDesk}
        testID="sidebar-desk-clear"
      />
    </>
  );

  return (
    <FolderBlockFrame testID="sidebar-desk-section">
      <FolderHeaderFrame
        rowTestID="sidebar-desk-row"
        toggleTestID="sidebar-desk-header"
        countTestID="sidebar-desk-count"
        name={t("sidebar.desk.title")}
        count={count}
        open={!collapsed}
        onToggle={toggleCollapsed}
        lead={deskLead}
        actions={actions}
      />
      {selectionActive && checked.length >= 1 ? (
        <DeskSelectionBar
          count={checked.length}
          targetViewName={targetView?.name ?? null}
          onColumns={handleColumns}
          onGrid={handleGrid}
          onAddToView={handleAddToView}
          onReplaceView={handleReplaceView}
          onCancel={exitSelection}
        />
      ) : null}
      {showEmpty ? (
        <FolderHint testID="sidebar-desk-empty">{t("sidebar.desk.empty")}</FolderHint>
      ) : null}
      {showGroups ? (
        <FolderRowsFrame>
          {deskGroups.map((group) => (
            <DeskGroupRows
              key={group.key}
              group={group}
              projectIconByProjectViewKey={projectIconByProjectViewKey}
              hostBadgeByServerId={hostBadgeByServerId}
              shortcutIndex={shortcutIndex}
              showShortcutBadges={showShortcutBadges}
              supportsPinningByServerId={supportsPinningByServerId}
              onToggleWorkspacePin={onToggleWorkspacePin}
              onWorkspacePress={onWorkspacePress}
              selectionActive={selectionActive}
              checked={checked}
              onToggleChecked={toggleChecked}
            />
          ))}
        </FolderRowsFrame>
      ) : null}
    </FolderBlockFrame>
  );
}

const DeskGroupRows = memo(function DeskGroupRows({
  group,
  projectIconByProjectViewKey,
  hostBadgeByServerId,
  shortcutIndex,
  showShortcutBadges,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  onWorkspacePress,
  selectionActive,
  checked,
  onToggleChecked,
}: {
  group: DeskGroup;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  shortcutIndex: Map<string, number>;
  showShortcutBadges: boolean;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onWorkspacePress?: () => void;
  selectionActive: boolean;
  checked: readonly string[];
  onToggleChecked: (workspaceKey: string) => void;
}) {
  const grouped = group.label !== null;
  return (
    <View style={grouped ? styles.group : undefined} testID={`sidebar-desk-group-${group.key}`}>
      {grouped ? (
        <Text style={styles.groupLabel} numberOfLines={1}>
          {group.label}
        </Text>
      ) : null}
      {group.rows.map((workspace) => (
        <DeskSelectableRow
          key={workspace.workspaceKey}
          workspaceKey={workspace.workspaceKey}
          name={workspace.name}
          selectionActive={selectionActive}
          checked={checked.includes(workspace.workspaceKey)}
          onToggle={onToggleChecked}
        >
          {(onPressIntercept) => (
            <StatusWorkspaceRow
              workspace={workspace}
              {...buildStatusRowProjectPresentation({
                workspace,
                projectIconByProjectViewKey,
                hostBadgeByServerId,
              })}
              inStatusGroup={grouped}
              shortcutNumber={shortcutIndex.get(workspace.workspaceKey) ?? null}
              showShortcutBadge={showShortcutBadges}
              canPin={supportsPinningByServerId.get(workspace.serverId) === true}
              onToggleWorkspacePin={onToggleWorkspacePin}
              onWorkspacePress={onWorkspacePress}
              onPressIntercept={onPressIntercept}
            />
          )}
        </DeskSelectableRow>
      ))}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  group: {
    paddingBottom: theme.spacing[1],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    opacity: 0.8,
  },
}));

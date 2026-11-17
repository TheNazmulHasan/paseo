import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, Text, View } from "react-native";
import { BrushCleaning, ListChecks } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { addWorkspacesToBoard, replaceBoardWorkspaces, splitWorkspaces } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { resolveSplitViewport } from "@/boards/workspace-picker-model";
import { isWeb } from "@/constants/platform";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { DeskSelectableRow } from "@/desk/desk-selectable-row";
import { DeskSelectionBar } from "@/desk/desk-selection-bar";
import { useDeskSelectionStore } from "@/desk/desk-selection-store";
import { useDeskStore } from "@/desk/desk-store";
import { useDeskTargetView } from "@/desk/target-view";
import type { DeskGroup, DeskGrouping } from "@/desk/model";
import { useClearDesk } from "@/desk/use-clear-desk";
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

const EMPTY_SHORTCUT_INDEX = new Map<string, number>();

/**
 * The Desk: the working set between Pinned and the Shelf. Rows are the sidebar's own workspace
 * row (status indicator, attention, menus and all); only their grouping is the Desk's.
 *
 * Reads the sidebar model and wires its own row dependencies, so the two lists that render it
 * pass nothing but `onWorkspacePress`.
 */
export function DeskSection({ onWorkspacePress }: { onWorkspacePress?: () => void }) {
  const { t } = useTranslation();
  const { deskGroups, shelfCount, projects, projectIconTargets, shortcutModel } = useSidebarModel();
  const storedGrouping = useDeskStore((state) => state.deskGrouping);
  const foldersAvailable = useFoldersAvailable();
  // The Folder grouping only exists while folders do; without them the sidebar shows Recent.
  const deskGrouping = storedGrouping === "folder" && !foldersAvailable ? "recent" : storedGrouping;
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
    () => [
      {
        value: "recent" as const,
        label: t("sidebar.desk.groupRecent"),
        testID: "desk-group-recent",
      },
      {
        value: "project" as const,
        label: t("sidebar.desk.groupProject"),
        testID: "desk-group-project",
      },
      {
        value: "status" as const,
        label: t("sidebar.desk.groupStatus"),
        testID: "desk-group-status",
      },
      ...(foldersAvailable
        ? [
            {
              value: "folder" as const,
              label: t("sidebar.desk.groupFolder"),
              testID: "desk-group-folder",
            },
          ]
        : []),
    ],
    [foldersAvailable, t],
  );
  const handleGroupingChange = useCallback(
    (grouping: DeskGrouping) => setDeskGrouping(grouping),
    [setDeskGrouping],
  );

  const showEmpty = !collapsed && deskGroups.length === 0;
  const showGroups = !collapsed && deskGroups.length > 0;

  // A sidebar with no workspaces yet has nothing to sort into Desk or Shelf.
  if (count === 0 && shelfCount === 0) {
    return null;
  }

  return (
    <View style={styles.section} testID="sidebar-desk-section">
      <SidebarSectionHeader
        title={t("sidebar.desk.title")}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        chevronAlwaysVisible
        testID="sidebar-desk-header"
        count={count}
        countTestID="sidebar-desk-count"
      >
        <SegmentedControl
          options={groupingOptions}
          value={deskGrouping}
          onValueChange={handleGroupingChange}
          size="sm"
          testID="sidebar-desk-grouping"
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
      </SidebarSectionHeader>
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
        <Text style={styles.empty} testID="sidebar-desk-empty">
          {t("sidebar.desk.empty")}
        </Text>
      ) : null}
      {showGroups
        ? deskGroups.map((group) => (
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
          ))
        : null}
    </View>
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
  section: {
    marginBottom: theme.spacing[1],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    opacity: 0.8,
  },
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

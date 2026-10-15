import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, Pressable, Text, View } from "react-native";
import { BrushCleaning, ChevronDown, ChevronRight, ListChecks } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { splitWorkspaces } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { resolveSplitViewport } from "@/boards/workspace-picker-model";
import { isWeb } from "@/constants/platform";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { DeskSelectableRow } from "@/desk/desk-selectable-row";
import { DeskSelectionBar } from "@/desk/desk-selection-bar";
import { useDeskSelectionStore } from "@/desk/desk-selection-store";
import { useDeskStore } from "@/desk/desk-store";
import type { DeskGroup, DeskGrouping } from "@/desk/model";
import { useClearDesk } from "@/desk/use-clear-desk";
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
import type { Theme } from "@/styles/theme";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  const deskGrouping = useDeskStore((state) => state.deskGrouping);
  const setDeskGrouping = useDeskStore((state) => state.setDeskGrouping);
  const collapsed = useDeskStore((state) => state.deskCollapsed);
  const toggleCollapsed = useDeskStore((state) => state.toggleDeskCollapsed);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;
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
    ],
    [t],
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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          onPress={toggleCollapsed}
          style={styles.titleGroup}
          testID="sidebar-desk-header"
        >
          <Chevron size={12} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.title} numberOfLines={1}>
            {t("sidebar.desk.title")}
          </Text>
          <Text style={styles.count} testID="sidebar-desk-count">
            {count}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <SegmentedControl
            options={groupingOptions}
            value={deskGrouping}
            onValueChange={handleGroupingChange}
            size="xs"
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
        </View>
      </View>
      {selectionActive && checked.length >= 2 ? (
        <DeskSelectionBar
          count={checked.length}
          onColumns={handleColumns}
          onGrid={handleGrid}
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
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.7,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 1,
    minWidth: 0,
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

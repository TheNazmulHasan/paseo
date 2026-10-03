import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { BrushCleaning, ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { DeskIconButton } from "@/desk/desk-icon-button";
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
            icon={BrushCleaning}
            label={t("sidebar.desk.clear")}
            onPress={clearDesk}
            testID="sidebar-desk-clear"
          />
        </View>
      </View>
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
}: {
  group: DeskGroup;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  shortcutIndex: Map<string, number>;
  showShortcutBadges: boolean;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onWorkspacePress?: () => void;
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
        <StatusWorkspaceRow
          key={workspace.workspaceKey}
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
        />
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

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { router, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react-native";
import { ViewRow, useViewRowActions } from "@/boards/boards-section";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { isViewActive } from "@/boards/views-model";
import { ViewRenameField } from "@/boards/view-rename-field";
import type { BoardSummary } from "@/boards/types";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import {
  buildStatusRowProjectPresentation,
  StatusWorkspaceRow,
} from "@/components/sidebar/sidebar-status-list";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { useFolderStore } from "@/folders/folder-store";
import { useFolderUiStore } from "@/folders/folder-ui-store";
import { FolderRowContext } from "@/folders/folder-row-button";
import {
  formatFolderNameInput,
  UNFILED_FOLDER_KEY,
  type FolderGroup,
  type FolderSection,
} from "@/folders/model";
import { useFolderActions } from "@/folders/use-folder-actions";
import { useAppSettings } from "@/hooks/use-settings";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import {
  shouldShowSidebarHostLabels,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedInbox = withUnistyles(Inbox);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const EMPTY_SHORTCUT_INDEX = new Map<string, number>();
const WORKSPACE_VISIBILITY = {
  kind: "workspaces" as const,
  getStatusBucket: (workspace: SidebarWorkspaceEntry) => workspace.statusBucket,
};

/**
 * The header that replaces the Shelf's while folders are available: the Folders title and fold
 * chevron, the count of folders, the always-visible + (new folder) and whatever the caller puts at
 * the trailing edge (the display menu, the only way back out of a sidebar filter).
 */
export function FoldersSectionHeader({
  onLayout,
  children,
}: {
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { folderSections } = useSidebarModel();
  const collapsed = useFolderUiStore((state) => state.sectionCollapsed);
  const toggleSection = useFolderUiStore((state) => state.toggleSection);
  const setCreating = useFolderStore((state) => state.setCreating);
  const folderCount = folderSections ? folderSections.length - 1 : 0;
  const handleNew = useCallback(() => {
    if (useFolderUiStore.getState().sectionCollapsed) toggleSection();
    setCreating(true);
  }, [setCreating, toggleSection]);
  return (
    <SidebarSectionHeader
      title={t("folders.title")}
      collapsed={collapsed}
      onToggle={toggleSection}
      chevronAlwaysVisible
      testID="sidebar-folders-header"
      count={folderCount}
      countTestID="sidebar-folders-count"
      onLayout={onLayout}
    >
      <DeskIconButton
        icon={FolderPlus}
        label={t("folders.new")}
        onPress={handleNew}
        testID="sidebar-folders-new"
      />
      {children}
    </SidebarSectionHeader>
  );
}

/** True while the Folders section stands in for the Shelf (some host has folders loaded). */
export function useFoldersReplaceShelf(): boolean {
  return useSidebarModel().folderSections !== null;
}

interface RowDeps {
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  shortcutIndex: Map<string, number>;
  showShortcutBadges: boolean;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onWorkspacePress?: () => void;
  activeBoardId: string | null;
}

/**
 * The body that replaces the Shelf's list: one block per folder, then Unfiled. Reads the sidebar
 * model and wires its own row dependencies, like the Desk, so the two sidebar lists that render it
 * pass nothing but `onWorkspacePress`. Renders nothing while no host has folders (the Shelf shows).
 */
export function FoldersBody({ onWorkspacePress }: { onWorkspacePress?: () => void }) {
  const { t } = useTranslation();
  const { folderSections, projects, projectIconTargets, shortcutModel } = useSidebarModel();
  const collapsed = useFolderUiStore((state) => state.sectionCollapsed);
  const openKeys = useFolderUiStore((state) => state.openKeys);
  const creating = useFolderStore((state) => state.creating);
  const setCreating = useFolderStore((state) => state.setCreating);
  const { createFolder } = useFolderActions();
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
  const pathname = usePathname();
  const activeBoardId = parseBoardIdFromPathname(pathname);
  const deps = useMemo<RowDeps>(
    () => ({
      projectIconByProjectViewKey,
      hostBadgeByServerId,
      shortcutIndex: showShortcutBadges
        ? shortcutModel.shortcutIndexByWorkspaceKey
        : EMPTY_SHORTCUT_INDEX,
      showShortcutBadges,
      supportsPinningByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      activeBoardId,
    }),
    [
      activeBoardId,
      hostBadgeByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      projectIconByProjectViewKey,
      shortcutModel.shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
    ],
  );
  const handleCreate = useCallback(
    (raw: string) => {
      setCreating(false);
      if (raw.trim().length > 0) void createFolder(raw);
    },
    [createFolder, setCreating],
  );
  const handleCancelCreate = useCallback(() => setCreating(false), [setCreating]);

  if (!folderSections || collapsed) {
    return null;
  }
  const hasFolders = folderSections.length > 1;
  return (
    <View style={styles.body} testID="sidebar-folders-section">
      {creating ? (
        <View style={styles.newRow} testID="sidebar-folders-new-row">
          <ThemedFolder size={14} uniProps={mutedMapping} />
          <View style={styles.nameSlot}>
            <ViewRenameField
              initialValue=""
              placeholder={t("folders.newPlaceholder")}
              onCommit={handleCreate}
              onCancel={handleCancelCreate}
            />
          </View>
        </View>
      ) : null}
      {hasFolders || creating ? null : (
        <Text style={styles.hint} testID="sidebar-folders-empty">
          {t("folders.empty")}
        </Text>
      )}
      {folderSections.map((section) => (
        <FolderBlock
          key={section.key}
          section={section}
          open={openKeys.includes(section.key)}
          deps={deps}
        />
      ))}
    </View>
  );
}

const FolderBlock = memo(function FolderBlock({
  section,
  open,
  deps,
}: {
  section: FolderSection<SidebarWorkspaceEntry, BoardSummary>;
  open: boolean;
  deps: RowDeps;
}) {
  const { group } = section;
  const toggleFolder = useFolderUiStore((state) => state.toggleFolder);
  const handleToggle = useCallback(() => toggleFolder(section.key), [section.key, toggleFolder]);
  return (
    <View style={styles.block} testID={`sidebar-folder-${section.key}`}>
      <FolderHeaderRow
        folderKey={section.key}
        group={group}
        count={section.count}
        open={open}
        onToggle={handleToggle}
      />
      {open ? <FolderRows section={section} deps={deps} /> : null}
    </View>
  );
});

function FolderHeaderRow({
  folderKey,
  group,
  count,
  open,
  onToggle,
}: {
  folderKey: string;
  group: FolderGroup | null;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { renameFolder, deleteFolder } = useFolderActions();
  const [renaming, setRenaming] = useState(false);
  const Chevron = open ? ThemedChevronDown : ThemedChevronRight;
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  const name = group ? group.name : t("folders.unfiled");

  const handleStartRename = useCallback(() => setRenaming(true), [setRenaming]);
  const handleCancelRename = useCallback(() => setRenaming(false), [setRenaming]);
  const handleCommitRename = useCallback(
    (raw: string) => {
      setRenaming(false);
      if (group && raw.trim().length > 0 && raw.trim() !== formatFolderNameInput(group)) {
        void renameFolder(group, raw);
      }
    },
    [group, renameFolder, setRenaming],
  );
  const handleDelete = useCallback(() => {
    if (group) void deleteFolder(group);
  }, [deleteFolder, group]);
  const handleNewWorkspace = useCallback(() => {
    useFolderStore.getState().setExplicitFolder({ folderKey, at: Date.now() });
    router.navigate(buildNewWorkspaceRoute() as never);
  }, [folderKey]);

  const lead = <FolderLead group={group} />;

  if (renaming && group) {
    return (
      <View style={styles.headerRow} testID={`sidebar-folder-row-${folderKey}`}>
        {lead}
        <View style={styles.nameSlot}>
          <ViewRenameField
            initialValue={formatFolderNameInput(group)}
            placeholder={t("folders.newPlaceholder")}
            onCommit={handleCommitRename}
            onCancel={handleCancelRename}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.headerRow} testID={`sidebar-folder-row-${folderKey}`}>
      <PressHighlight
        style={styles.toggle}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={name}
        testID={`sidebar-folder-toggle-${folderKey}`}
      >
        <Chevron size={12} uniProps={mutedMapping} />
        {lead}
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count} testID={`sidebar-folder-count-${folderKey}`}>
          {count}
        </Text>
      </PressHighlight>
      {group ? (
        <View style={styles.actions}>
          <DeskIconButton
            icon={Plus}
            label={t("folders.newWorkspace")}
            onPress={handleNewWorkspace}
            testID={`sidebar-folder-new-workspace-${folderKey}`}
          />
          <DeskIconButton
            icon={Pencil}
            label={t("folders.rename")}
            onPress={handleStartRename}
            testID={`sidebar-folder-rename-${folderKey}`}
          />
          <DeskIconButton
            icon={Trash2}
            label={t("folders.delete")}
            onPress={handleDelete}
            testID={`sidebar-folder-delete-${folderKey}`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The folder's emoji, a plain folder glyph when it has none, or the tray for Unfiled. */
function FolderLead({ group }: { group: FolderGroup | null }) {
  if (!group) {
    return <ThemedInbox size={14} uniProps={mutedMapping} />;
  }
  return group.emoji ? (
    <Text style={styles.emoji}>{group.emoji}</Text>
  ) : (
    <ThemedFolder size={14} uniProps={mutedMapping} />
  );
}

function FolderRows({
  section,
  deps,
}: {
  section: FolderSection<SidebarWorkspaceEntry, BoardSummary>;
  deps: RowDeps;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const viewActions = useViewRowActions({
    boards: section.boards,
    onWorkspacePress: deps.onWorkspacePress,
  });
  const { leadingItem, visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(
    {
      items: section.workspaces,
      selection: activeWorkspaceSelection,
      policy: WORKSPACE_VISIBILITY,
    },
  );

  const renderWorkspace = (workspace: SidebarWorkspaceEntry) => (
    <StatusWorkspaceRow
      key={workspace.workspaceKey}
      workspace={workspace}
      {...buildStatusRowProjectPresentation({
        workspace,
        projectIconByProjectViewKey: deps.projectIconByProjectViewKey,
        hostBadgeByServerId: deps.hostBadgeByServerId,
      })}
      inStatusGroup={false}
      shortcutNumber={
        section.numberedKeys.has(workspace.workspaceKey)
          ? (deps.shortcutIndex.get(workspace.workspaceKey) ?? null)
          : null
      }
      showShortcutBadge={deps.showShortcutBadges}
      canPin={deps.supportsPinningByServerId.get(workspace.serverId) === true}
      onToggleWorkspacePin={deps.onToggleWorkspacePin}
      onWorkspacePress={deps.onWorkspacePress}
    />
  );

  return (
    <FolderRowContext.Provider value>
      <View style={styles.rows} testID={`sidebar-folder-rows-${section.key}`}>
        {section.boards.map((board) => (
          <ViewRow
            key={board.id}
            board={board}
            active={isViewActive(deps.activeBoardId, board.id)}
            editing={viewActions.editingId === board.id}
            onOpen={viewActions.onOpen}
            onStartRename={viewActions.onStartRename}
            onCancelRename={viewActions.onCancelRename}
            onCommitRename={viewActions.onCommitRename}
            onDelete={viewActions.onDelete}
          />
        ))}
        {leadingItem ? renderWorkspace(leadingItem) : null}
        {visibleItems.map(renderWorkspace)}
        {canToggle ? (
          <SidebarGroupToggleRow
            expanded={expanded}
            onPress={toggleExpanded}
            testID={`sidebar-folder-show-more-${section.key}`}
          />
        ) : null}
        {section.key === UNFILED_FOLDER_KEY && section.count === 0 ? <FolderEmptyHint /> : null}
      </View>
    </FolderRowContext.Provider>
  );
}

function FolderEmptyHint() {
  const { t } = useTranslation();
  return <Text style={styles.hint}>{t("folders.unfiledEmpty")}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    marginBottom: theme.spacing[1],
  },
  block: {
    marginBottom: theme.spacing[0.5],
  },
  headerRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
  },
  newRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  nameSlot: { flex: 1, minWidth: 0 },
  emoji: { fontSize: 14, width: 14, textAlign: "center" },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  rows: {
    paddingLeft: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    opacity: 0.8,
  },
}));

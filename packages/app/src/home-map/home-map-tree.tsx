import { memo, useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Folder,
  Inbox,
} from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { DeskIconButton } from "@/desk/desk-icon-button";
import type { Theme } from "@/styles/theme";
import { useHomeStore } from "./home-store";
import {
  hasFoldedNode,
  isNodeOpen,
  type HomeFolderNode,
  type HomeSession,
  type HomeWorkspaceNode,
} from "./model";
import { openHomeSession, openHomeWorkspace } from "./open-session";
import { ActivityAge, CountsLine, StateDot } from "./state-dot";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedBookmark = withUnistyles(Bookmark);
const ThemedFolder = withUnistyles(Folder);
const ThemedInbox = withUnistyles(Inbox);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const SessionLine = memo(function SessionLine({ session }: { session: HomeSession }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (!session.workspaceId) return;
    openHomeSession({
      serverId: session.serverId,
      workspaceId: session.workspaceId,
      agentId: session.agentId,
    });
  }, [session.agentId, session.serverId, session.workspaceId]);
  const text = session.yourMoveText ?? session.title ?? t("homeMap.map.untitled");
  return (
    <PressHighlight
      style={styles.sessionLine}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={text}
      testID={`home-map-session-${session.key}`}
    >
      <StateDot state={session.state} />
      <Text style={styles.sessionText} numberOfLines={1}>
        {text}
      </Text>
      <ActivityAge at={session.lastActivityAt} />
    </PressHighlight>
  );
});

const WorkspaceNodeView = memo(function WorkspaceNodeView({ node }: { node: HomeWorkspaceNode }) {
  const { t } = useTranslation();
  const open = useHomeStore((state) => isNodeOpen(state, node.key, "workspace"));
  const toggleNode = useHomeStore((state) => state.toggleNode);
  const handleToggle = useCallback(() => toggleNode(node.key, "workspace"), [node.key, toggleNode]);
  const handleOpen = useCallback(
    () => openHomeWorkspace({ serverId: node.serverId, workspaceId: node.workspaceId }),
    [node.serverId, node.workspaceId],
  );
  return (
    <View testID={`home-map-workspace-${node.key}`}>
      <View style={styles.workspaceRow}>
        <DeskIconButton
          icon={open ? ChevronDown : ChevronRight}
          label={
            open
              ? t("homeMap.map.fold", { name: node.name })
              : t("homeMap.map.unfold", { name: node.name })
          }
          onPress={handleToggle}
          testID={`home-map-toggle-${node.key}`}
          size={12}
        />
        <PressHighlight
          style={styles.workspaceMain}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel={node.name}
          testID={`home-map-open-${node.key}`}
        >
          <StateDot state={node.state} />
          <Text style={styles.workspaceName} numberOfLines={1}>
            {node.name}
          </Text>
          <CountsLine counts={node.counts} />
          <ActivityAge at={node.lastActivityAt} />
        </PressHighlight>
      </View>
      {open ? (
        <View style={styles.sessions}>
          {node.sessions.map((session) => (
            <SessionLine key={session.key} session={session} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function FolderLead({ node }: { node: HomeFolderNode }) {
  if (node.builtin === "desk") return <ThemedBookmark size={14} uniProps={mutedMapping} />;
  if (node.builtin === "unfiled") return <ThemedInbox size={14} uniProps={mutedMapping} />;
  if (node.emoji) return <Text style={styles.emoji}>{node.emoji}</Text>;
  return <ThemedFolder size={14} uniProps={mutedMapping} />;
}

const FolderNodeView = memo(function FolderNodeView({ node }: { node: HomeFolderNode }) {
  const { t } = useTranslation();
  const open = useHomeStore((state) => isNodeOpen(state, node.key, "folder"));
  const toggleNode = useHomeStore((state) => state.toggleNode);
  const handleToggle = useCallback(() => toggleNode(node.key, "folder"), [node.key, toggleNode]);
  const name = useMemo(() => {
    if (node.builtin === "desk") return t("homeMap.map.desk");
    if (node.builtin === "unfiled") return t("homeMap.map.unfiled");
    return node.name;
  }, [node.builtin, node.name, t]);
  const Chevron = open ? ThemedChevronDown : ThemedChevronRight;
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  return (
    <View style={styles.folder} testID={`home-map-folder-${node.key}`}>
      <PressHighlight
        style={styles.folderRow}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={
          open ? t("homeMap.map.fold", { name }) : t("homeMap.map.unfold", { name })
        }
        testID={`home-map-toggle-${node.key}`}
      >
        <Chevron size={12} uniProps={mutedMapping} />
        <FolderLead node={node} />
        <Text style={styles.folderName} numberOfLines={1}>
          {name}
        </Text>
        <CountsLine counts={node.counts} testID={`home-map-counts-${node.key}`} />
        <View style={styles.spacer} />
        <StateDot state={node.state} />
        <ActivityAge at={node.lastActivityAt} />
      </PressHighlight>
      {open ? (
        <View style={styles.workspaces}>
          {node.workspaces.map((workspace) => (
            <WorkspaceNodeView key={workspace.key} node={workspace} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * The map: Folder -> workspace -> session, foldable at every level, drawn from the live stores.
 * Its header holds the two always-visible controls: Unfold all / Fold all, and Show quiet.
 */
export const HomeMapSection = memo(function HomeMapSection({
  tree,
}: {
  tree: readonly HomeFolderNode[];
}) {
  const { t } = useTranslation();
  const baseline = useHomeStore((state) => state.baseline);
  const overrides = useHomeStore((state) => state.overrides);
  const showQuiet = useHomeStore((state) => state.showQuiet);
  const setAll = useHomeStore((state) => state.setAll);
  const setShowQuiet = useHomeStore((state) => state.setShowQuiet);
  const anyFolded = useMemo(
    () => hasFoldedNode(tree, { baseline, overrides }),
    [baseline, overrides, tree],
  );
  const handleFoldAll = useCallback(() => setAll(anyFolded), [anyFolded, setAll]);
  const handleToggleQuiet = useCallback(() => setShowQuiet(!showQuiet), [setShowQuiet, showQuiet]);
  const quietState = useMemo(() => ({ selected: showQuiet }), [showQuiet]);
  return (
    <View style={styles.section} testID="home-map">
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("homeMap.map.title")}</Text>
        <View style={styles.sectionActions}>
          <Button
            variant={showQuiet ? "secondary" : "ghost"}
            size="sm"
            leftIcon={showQuiet ? Eye : EyeOff}
            onPress={handleToggleQuiet}
            accessibilityState={quietState}
            testID="home-map-show-quiet"
          >
            {t("homeMap.map.showQuiet")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={anyFolded ? ChevronsUpDown : ChevronsDownUp}
            onPress={handleFoldAll}
            testID="home-map-fold-all"
          >
            {anyFolded ? t("homeMap.map.unfoldAll") : t("homeMap.map.foldAll")}
          </Button>
        </View>
      </View>
      {tree.length === 0 ? (
        <Text style={styles.empty} testID="home-map-empty">
          {t("homeMap.map.empty")}
        </Text>
      ) : (
        tree.map((folder) => <FolderNodeView key={folder.key} node={folder} />)
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    minWidth: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  folder: {
    marginBottom: theme.spacing[0.5],
  },
  folderRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    minWidth: 0,
  },
  folderName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
  },
  emoji: {
    fontSize: theme.fontSize.base,
  },
  spacer: {
    flexGrow: 1,
  },
  workspaces: {
    paddingLeft: theme.spacing[4],
  },
  workspaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  workspaceMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  workspaceName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
    minWidth: 0,
  },
  sessions: {
    paddingLeft: theme.spacing[8],
  },
  sessionLine: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    minWidth: 0,
  },
  sessionText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

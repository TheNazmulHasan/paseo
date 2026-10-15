import { View, Text, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveExplorerSidebarWidth } from "@/components/explorer-sidebar-layout";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { WindowChromeSafeArea } from "@/utils/desktop-window";

/**
 * The selected project's Files tree beside the New workspace composer, so the folder
 * you are about to point a chat at is visible before the workspace exists.
 *
 * No workspace exists yet, so the tree is rooted at the project's source directory and
 * keyed by that path (`useFileExplorerActions` falls back to `root:<path>` when
 * `workspaceId` is null). Open-in-tab and add-to-chat need a workspace and are absent;
 * the row icons (Copy path, Reveal in Finder) and the right-click menu still work.
 * Renders nothing on compact layouts or until a project is selected.
 */
export function NewWorkspaceFilesSidebar({
  serverId,
  sourceDirectory,
}: {
  serverId: string | null;
  sourceDirectory: string | null | undefined;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { width: windowWidth } = useWindowDimensions();
  if (isCompact || !serverId || !sourceDirectory) {
    return null;
  }
  const width = resolveExplorerSidebarWidth({ containerWidth: windowWidth });
  return (
    <View style={[styles.sidebar, { width }]} testID="new-workspace-files-sidebar">
      <WindowChromeSafeArea placement="inline" style={styles.header}>
        <TitlebarDragRegion />
        <View style={styles.tab}>
          <Text style={styles.tabText}>{t("workspace.tabs.explorerSidebar.files")}</Text>
        </View>
      </WindowChromeSafeArea>
      <View style={styles.body}>
        <FileExplorerPane
          key={`${serverId}:${sourceDirectory}`}
          serverId={serverId}
          workspaceId={null}
          workspaceRoot={sourceDirectory}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sidebar: {
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
    userSelect: "auto",
  },
  header: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tabText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
}));

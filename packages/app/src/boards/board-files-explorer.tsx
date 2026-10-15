import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardWorkspaceIdentity } from "@/boards/use-board-workspace-identity";
import type { BoardTabOrigin } from "@/boards/types";
import { ProjectIconView } from "@/components/project-icon-view";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

const EXPLORER_WIDTH = 320;
const PROJECT_ICON_SIZE = 14;
const FILES_TARGET: WorkspaceTabTarget = { kind: "files" };

interface BoardFilesExplorerProps {
  origin: Pick<BoardTabOrigin, "serverId" | "workspaceId">;
  identity: BoardWorkspaceIdentity;
  isScreenFocused: boolean;
  /** Anything the explorer opens (a file) goes back to the board, which places it. */
  onOpenTarget: (target: WorkspaceTabTarget) => void;
}

/**
 * The workspace screen's Files explorer for one workspace of a view: the upstream "files" panel,
 * mounted through the same pane-content model every other panel uses, with a header naming the
 * workspace. It carries no layout of its own; the board decides whose workspace it shows.
 */
export function BoardFilesExplorer({
  origin,
  identity,
  isScreenFocused,
  onOpenTarget,
}: BoardFilesExplorerProps) {
  const { serverId, workspaceId } = origin;
  const content = useMemo(() => {
    const tabId = `board-explorer:${serverId}:${workspaceId}`;
    return buildWorkspacePaneContentModel({
      tab: { key: tabId, tabId, kind: "files", target: FILES_TARGET },
      normalizedServerId: serverId,
      normalizedWorkspaceId: workspaceId,
      host: "explorer",
      onOpenTab: onOpenTarget,
      onOpenPreferredTarget: (target) => onOpenTarget(target),
      onOpenTargetToSide: (target) => onOpenTarget(target),
      onCloseCurrentTab: () => {},
      onRetargetCurrentTab: () => {},
      onSetCurrentTabState: () => {},
      onOpenWorkspaceFile: (request) => onOpenTarget({ kind: "file", ...request.location }),
      onOpenUrlInBrowserTab: () => false,
      onOpenImportSheet: () => {},
    });
  }, [onOpenTarget, serverId, workspaceId]);

  return (
    <View style={styles.container} testID="board-files-explorer">
      <View style={styles.headerLine} testID="board-files-explorer-header">
        <ProjectIconView
          iconDataUri={identity.iconDataUri}
          initial={identity.initial}
          projectViewKey={identity.projectViewKey}
          size={PROJECT_ICON_SIZE}
          textStyle={styles.projectIconText}
        />
        <Text style={styles.headerWorkspaceName} numberOfLines={1}>
          {identity.workspaceName}
        </Text>
      </View>
      <View style={styles.content}>
        <WorkspacePaneContent
          content={content}
          isWorkspaceFocused={isScreenFocused}
          isPaneFocused
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: EXPLORER_WIDTH,
    flexShrink: 0,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  headerLine: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerWorkspaceName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  projectIconText: {
    fontSize: 9,
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
}));

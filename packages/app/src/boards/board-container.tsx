import { Fragment, memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { BoardPane } from "@/boards/board-pane";
import {
  focusBoardPane,
  removeBoardTab,
  resizeBoardSplit,
  selectBoardTab,
} from "@/boards/controller";
import {
  isBoardNodeHidden,
  resolveBoardGroupFlex,
  resolveBoardGroupSizes,
} from "@/boards/screen-helpers";
import { boardTabTarget } from "@/boards/model";
import type { Board, BoardTabOrigin } from "@/boards/types";
import {
  useBoardWorkspaceIdentities,
  type BoardWorkspaceIdentityMap,
} from "@/boards/use-board-workspace-identity";
import { ResizeHandle } from "@/components/resize-handle";
import { RetainedPanel } from "@/components/retained-panel";
import { useStableEvent } from "@/hooks/use-stable-event";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { collectAllTabs, type SplitNode } from "@/stores/workspace-layout-actions";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { createWorkspaceFileTabTarget } from "@/workspace/file-open";
import type { ArrangeViewport } from "@/arrange/types";

type BuildPaneContentModel = (input: {
  paneId: string;
  tab: WorkspaceTabDescriptor;
}) => WorkspacePaneContentModel;

interface BoardContainerProps {
  board: Board;
  isScreenFocused: boolean;
  /** Reports the measured pixel size of the board area, the viewport arrange calls lay out into. */
  onViewportChange: (viewport: ArrangeViewport) => void;
}

interface BoardNodeViewProps {
  node: SplitNode;
  board: Board;
  allTabs: WorkspaceTab[];
  identities: BoardWorkspaceIdentityMap;
  isScreenFocused: boolean;
  onFocusPane: (paneId: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenInWorkspace: (origin: BoardTabOrigin) => void;
  buildPaneContentModel: BuildPaneContentModel;
}

/** Sends a session's own workspace to the foreground, with that session's tab opened there. */
function openInOriginWorkspace(origin: BoardTabOrigin, target?: WorkspaceTabTarget) {
  navigateToWorkspace({
    serverId: origin.serverId,
    workspaceId: origin.workspaceId,
    target: target ?? boardTabTarget(origin),
  });
}

/**
 * The board layout tree, rendered with the workspace's own pieces (resize handle, panel host,
 * AgentPanel) but none of its single-workspace coupling: every tab carries its own host and
 * workspace through `board.origins`.
 */
export function BoardContainer({ board, isScreenFocused, onViewportChange }: BoardContainerProps) {
  const boardId = board.id;
  const identities = useBoardWorkspaceIdentities();
  const allTabs = useMemo(() => collectAllTabs(board.layout.root), [board.layout.root]);
  const origins = board.origins;

  const handleFocusPane = useCallback(
    (paneId: string) => focusBoardPane(boardId, paneId),
    [boardId],
  );
  const handleSelectTab = useCallback(
    (paneId: string, tabId: string) => selectBoardTab(boardId, paneId, tabId),
    [boardId],
  );
  const handleCloseTab = useCallback((tabId: string) => removeBoardTab(boardId, tabId), [boardId]);
  const handleOpenInWorkspace = useCallback(
    (origin: BoardTabOrigin) => openInOriginWorkspace(origin),
    [],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      onViewportChange({ width, height });
    },
    [onViewportChange],
  );

  const buildPaneContentModel = useCallback<BuildPaneContentModel>(
    ({ tab }) => {
      // The pane drops tabs without an origin before mounting, so this is always set.
      const origin = origins[tab.tabId] ?? { serverId: "", workspaceId: "" };
      const openInWorkspace = (target?: WorkspaceTabTarget) =>
        openInOriginWorkspace(origin, target);
      return buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: origin.serverId,
        normalizedWorkspaceId: origin.workspaceId,
        host: "main",
        onOpenTab: openInWorkspace,
        onOpenPreferredTarget: (target) => openInWorkspace(target),
        onOpenTargetToSide: (target) => openInWorkspace(target),
        onCloseCurrentTab: () => removeBoardTab(boardId, tab.tabId),
        onRetargetCurrentTab: () => {},
        onSetCurrentTabState: () => {},
        onOpenWorkspaceFile: (request) =>
          openInWorkspace(createWorkspaceFileTabTarget(request.location)),
        onOpenUrlInBrowserTab: () => false,
        onOpenImportSheet: () => openInWorkspace(),
      });
    },
    [boardId, origins],
  );

  return (
    <View style={styles.container} onLayout={handleLayout} testID={`board-container-${boardId}`}>
      <BoardNodeView
        node={board.layout.root}
        board={board}
        allTabs={allTabs}
        identities={identities}
        isScreenFocused={isScreenFocused}
        onFocusPane={handleFocusPane}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenInWorkspace={handleOpenInWorkspace}
        buildPaneContentModel={buildPaneContentModel}
      />
    </View>
  );
}

function BoardNodeView(props: BoardNodeViewProps) {
  const { node } = props;
  if (node.kind === "pane") {
    return <BoardPaneNode {...props} node={node} />;
  }
  return <BoardGroupView {...props} node={node} />;
}

const BoardPaneNode = memo(function BoardPaneNode({
  node,
  board,
  allTabs,
  identities,
  isScreenFocused,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onOpenInWorkspace,
  buildPaneContentModel,
}: BoardNodeViewProps & { node: Extract<SplitNode, { kind: "pane" }> }) {
  return (
    <RetainedPanel active={node.pane.hidden !== true}>
      <BoardPane
        boardId={board.id}
        pane={node.pane}
        allTabs={allTabs}
        origins={board.origins}
        identities={identities}
        isFocused={node.pane.id === board.layout.focusedPaneId}
        isScreenFocused={isScreenFocused}
        onFocusPane={onFocusPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onOpenInWorkspace={onOpenInWorkspace}
        buildPaneContentModel={buildPaneContentModel}
      />
    </RetainedPanel>
  );
});

function BoardGroupChild({
  resizeFlex,
  index,
  hidden,
  children,
}: {
  resizeFlex: SharedValue<number[]>;
  index: number;
  hidden: boolean;
  children: ReactNode;
}) {
  const resizeStyle = useAnimatedStyle(() => ({
    flexGrow: resizeFlex.value[index] ?? 0,
  }));
  const childStyle = useMemo(
    () => [
      styles.groupChild,
      {
        flexShrink: hidden ? 0 : 1,
        flexBasis: 0,
        ...(hidden ? { width: 0, height: 0 } : {}),
      },
    ],
    [hidden],
  );
  return <Animated.View style={[childStyle, resizeStyle]}>{children}</Animated.View>;
}

function BoardGroupView(
  props: BoardNodeViewProps & { node: Extract<SplitNode, { kind: "group" }> },
) {
  const { node, board } = props;
  const { group } = node;
  const boardId = board.id;
  const [containerSize, setContainerSize] = useState(0);

  const sizes = useMemo(
    () => resolveBoardGroupSizes(group, board.splitSizes),
    [group, board.splitSizes],
  );
  const visibleFlex = useMemo(
    () => resolveBoardGroupFlex(group.children, sizes),
    [group.children, sizes],
  );
  const resizeFlex = useSharedValue(visibleFlex);
  useEffect(() => {
    resizeFlex.value = visibleFlex;
  }, [resizeFlex, visibleFlex]);

  const previewResizeSplit = useCallback(
    (_groupId: string, nextSizes: number[]) => {
      resizeFlex.value = resolveBoardGroupFlex(group.children, nextSizes);
    },
    [group.children, resizeFlex],
  );
  const commitResizeSplit = useStableEvent((groupId: string, nextSizes: number[]) =>
    resizeBoardSplit(boardId, groupId, nextSizes),
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      const next = group.direction === "horizontal" ? width : height;
      setContainerSize((current) => (current === next ? current : next));
    },
    [group.direction],
  );
  const groupStyle = useMemo(
    () => [
      styles.group,
      group.direction === "horizontal" ? styles.groupHorizontal : styles.groupVertical,
    ],
    [group.direction],
  );

  return (
    <View style={groupStyle} onLayout={handleLayout}>
      {group.children.map((child, index) => {
        const next = group.children[index + 1];
        const showHandle = Boolean(next) && !isBoardNodeHidden(child) && !isBoardNodeHidden(next);
        return (
          <Fragment key={child.kind === "pane" ? child.pane.id : child.group.id}>
            <BoardGroupChild
              resizeFlex={resizeFlex}
              index={index}
              hidden={isBoardNodeHidden(child)}
            >
              <BoardNodeView {...props} node={child} />
            </BoardGroupChild>
            {showHandle ? (
              <ResizeHandle
                testID="board-split-resize-handle"
                direction={group.direction}
                groupId={group.id}
                index={index}
                sizes={sizes}
                containerSize={containerSize}
                onPreviewResizeSplit={previewResizeSplit}
                onResizeSplit={commitResizeSplit}
              />
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  group: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  groupHorizontal: {
    flexDirection: "row",
  },
  groupVertical: {
    flexDirection: "column",
  },
  groupChild: {
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
  },
});

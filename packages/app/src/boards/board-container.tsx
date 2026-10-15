import { Fragment, memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { BoardPane } from "@/boards/board-pane";
import { BoardPaneDndProvider } from "@/boards/board-pane-dnd";
import { BoardPaneStrip, type BoardPaneStripEntry } from "@/boards/board-pane-strip";
import {
  focusBoardPane,
  openDraftInPane,
  openFileBeside,
  removeBoardTab,
  removeWorkspaceFromBoard,
  resizeBoardSplit,
  retargetBoardTab,
  selectBoardTab,
} from "@/boards/controller";
import { BoardFilesExplorer } from "@/boards/board-files-explorer";
import {
  boardWorkspaceKey,
  findBoardPane,
  isBoardNodeHiddenInView,
  listVisibleBoardPaneIds,
  resolveBoardGroupFlex,
  resolveBoardGroupSizes,
  resolveFocusedPaneOrigin,
  resolvePaneActiveTabId,
  resolveSoloBoardPaneId,
  shouldShowOnlyFocusedBoardPane,
} from "@/boards/screen-helpers";
import { boardTabTarget } from "@/boards/model";
import type { Board, BoardTabOrigin } from "@/boards/types";
import {
  fallbackBoardWorkspaceIdentity,
  useBoardWorkspaceIdentities,
  type BoardWorkspaceIdentityMap,
} from "@/boards/use-board-workspace-identity";
import { ResizeHandle } from "@/components/resize-handle";
import { RetainedPanel } from "@/components/retained-panel";
import { useStableEvent } from "@/hooks/use-stable-event";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { collectAllPanes, collectAllTabs, type SplitNode } from "@/stores/workspace-layout-actions";
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
  /** Narrow window: the only pane on screen (the rest are hidden). Null = the full layout. */
  soloPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenInWorkspace: (origin: BoardTabOrigin) => void;
  onNewAgent: (paneId: string) => void;
  onRemoveWorkspace?: (paneId: string) => void;
  /** False while the view has a single pane. */
  canRemove: boolean;
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
 * A file asked for from inside a view opens as a tab beside the pane it came from (that
 * workspace's files pane); only when the board cannot place it does it go to the workspace.
 * Everything else still opens in the session's own workspace.
 */
function openTargetFromPane(
  boardId: string,
  paneId: string,
  origin: BoardTabOrigin,
  target?: WorkspaceTabTarget,
) {
  if (target?.kind === "file") {
    const { kind: _kind, ...location } = target;
    if (openFileBeside(boardId, paneId, origin, location)) {
      return;
    }
  }
  openInOriginWorkspace(origin, target);
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
  const handleNewAgent = useCallback(
    (paneId: string) => {
      openDraftInPane(boardId, paneId);
    },
    [boardId],
  );
  const handleRemoveWorkspace = useCallback(
    (paneId: string) => {
      removeWorkspaceFromBoard(boardId, paneId);
    },
    [boardId],
  );
  const canRemove = collectAllPanes(board.layout.root).length > 1;
  const [viewport, setViewport] = useState<ArrangeViewport | null>(null);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      onViewportChange({ width, height });
      setViewport((current) =>
        current && current.width === width && current.height === height
          ? current
          : { width, height },
      );
    },
    [onViewportChange],
  );
  // Too narrow for its panes (a quarter-screen window): show only the focused pane, with a
  // strip to switch. The strip appears only in this mode and the decision reads the full area,
  // so it cannot flip itself back and forth.
  const focusOnly = shouldShowOnlyFocusedBoardPane({
    root: board.layout.root,
    splitSizes: board.splitSizes,
    viewport,
  });
  const soloPaneId = focusOnly
    ? resolveSoloBoardPaneId(board.layout.root, board.layout.focusedPaneId)
    : null;
  const stripPanes = useMemo<BoardPaneStripEntry[]>(
    () =>
      soloPaneId === null
        ? []
        : listVisibleBoardPaneIds(board.layout.root).map((paneId) => {
            const tabId = resolvePaneActiveTabId(findBoardPane(board.layout.root, paneId));
            const origin = tabId ? origins[tabId] : undefined;
            return {
              paneId,
              identity: origin
                ? (identities.get(boardWorkspaceKey(origin)) ??
                  fallbackBoardWorkspaceIdentity(origin.workspaceId))
                : null,
            };
          }),
    [board.layout.root, identities, origins, soloPaneId],
  );
  const getPaneLabel = useCallback(
    (paneId: string) => {
      const tabId = resolvePaneActiveTabId(findBoardPane(board.layout.root, paneId));
      const origin = tabId ? origins[tabId] : undefined;
      return origin
        ? (
            identities.get(boardWorkspaceKey(origin)) ??
            fallbackBoardWorkspaceIdentity(origin.workspaceId)
          ).workspaceName
        : "";
    },
    [board.layout.root, identities, origins],
  );
  const { t } = useTranslation();

  const buildPaneContentModel = useCallback<BuildPaneContentModel>(
    ({ paneId, tab }) => {
      // The pane drops tabs without an origin before mounting, so this is always set.
      const origin = origins[tab.tabId] ?? { serverId: "", workspaceId: "" };
      const openInWorkspace = (target?: WorkspaceTabTarget) =>
        openTargetFromPane(boardId, paneId, origin, target);
      return buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: origin.serverId,
        normalizedWorkspaceId: origin.workspaceId,
        host: "main",
        onOpenTab: openInWorkspace,
        onOpenPreferredTarget: (target) => openInWorkspace(target),
        onOpenTargetToSide: (target) => openInWorkspace(target),
        onCloseCurrentTab: () => removeBoardTab(boardId, tab.tabId),
        onRetargetCurrentTab: (target) => retargetBoardTab(boardId, tab.tabId, target),
        onSetCurrentTabState: () => {},
        onOpenWorkspaceFile: (request) =>
          openInWorkspace(createWorkspaceFileTabTarget(request.location)),
        onOpenUrlInBrowserTab: () => false,
        onOpenImportSheet: () => openInWorkspace(),
      });
    },
    [boardId, origins],
  );

  // The explorer shows the workspace of the focused pane's session and follows focus.
  const explorerSource = board.explorerOpen ? resolveFocusedPaneOrigin(board) : null;
  const explorerPaneId = explorerSource?.paneId ?? null;
  const explorerOrigin = explorerSource?.origin ?? null;
  const handleExplorerOpen = useCallback(
    (target: WorkspaceTabTarget) => {
      if (explorerPaneId && explorerOrigin) {
        openTargetFromPane(boardId, explorerPaneId, explorerOrigin, target);
      }
    },
    [boardId, explorerOrigin, explorerPaneId],
  );

  return (
    <View style={styles.row} testID={`board-container-${boardId}`}>
      <View style={styles.container} onLayout={handleLayout}>
        {soloPaneId !== null ? (
          <BoardPaneStrip
            panes={stripPanes}
            focusedPaneId={soloPaneId}
            label={t("boards.screen.paneStrip")}
            onFocusPane={handleFocusPane}
          />
        ) : null}
        <View style={styles.tree}>
          <BoardPaneDndProvider boardId={boardId} getPaneLabel={getPaneLabel}>
            <BoardNodeView
              node={board.layout.root}
              board={board}
              allTabs={allTabs}
              identities={identities}
              isScreenFocused={isScreenFocused}
              soloPaneId={soloPaneId}
              onFocusPane={handleFocusPane}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onOpenInWorkspace={handleOpenInWorkspace}
              onNewAgent={handleNewAgent}
              onRemoveWorkspace={board.kind === "live" ? undefined : handleRemoveWorkspace}
              canRemove={canRemove}
              buildPaneContentModel={buildPaneContentModel}
            />
          </BoardPaneDndProvider>
        </View>
      </View>
      {explorerOrigin ? (
        <BoardFilesExplorer
          key={boardWorkspaceKey(explorerOrigin)}
          origin={explorerOrigin}
          identity={
            identities.get(boardWorkspaceKey(explorerOrigin)) ??
            fallbackBoardWorkspaceIdentity(explorerOrigin.workspaceId)
          }
          isScreenFocused={isScreenFocused}
          onOpenTarget={handleExplorerOpen}
        />
      ) : null}
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
  soloPaneId,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onOpenInWorkspace,
  onNewAgent,
  onRemoveWorkspace,
  canRemove,
  buildPaneContentModel,
}: BoardNodeViewProps & { node: Extract<SplitNode, { kind: "pane" }> }) {
  return (
    <RetainedPanel active={!isBoardNodeHiddenInView(node, soloPaneId)}>
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
        onNewAgent={onNewAgent}
        onRemoveWorkspace={onRemoveWorkspace}
        canRemove={canRemove}
        dragEnabled={soloPaneId === null}
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
  const { node, board, soloPaneId } = props;
  const { group } = node;
  const isHidden = useCallback(
    (child: SplitNode) => isBoardNodeHiddenInView(child, soloPaneId),
    [soloPaneId],
  );
  const boardId = board.id;
  const [containerSize, setContainerSize] = useState(0);

  const sizes = useMemo(
    () => resolveBoardGroupSizes(group, board.splitSizes),
    [group, board.splitSizes],
  );
  const visibleFlex = useMemo(
    () => resolveBoardGroupFlex(group.children, sizes, isHidden),
    [group.children, isHidden, sizes],
  );
  const resizeFlex = useSharedValue(visibleFlex);
  useEffect(() => {
    resizeFlex.value = visibleFlex;
  }, [resizeFlex, visibleFlex]);

  const previewResizeSplit = useCallback(
    (_groupId: string, nextSizes: number[]) => {
      resizeFlex.value = resolveBoardGroupFlex(group.children, nextSizes, isHidden);
    },
    [group.children, isHidden, resizeFlex],
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
        const showHandle = Boolean(next) && !isHidden(child) && !isHidden(next);
        return (
          <Fragment key={child.kind === "pane" ? child.pane.id : child.group.id}>
            <BoardGroupChild resizeFlex={resizeFlex} index={index} hidden={isHidden(child)}>
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
  row: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    minHeight: 0,
  },
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  tree: {
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

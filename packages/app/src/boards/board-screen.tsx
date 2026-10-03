import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useBoardSidebarKeys } from "@/boards/use-board-sidebar-keys";
import { Text, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react-native";
import type { ArrangeViewport } from "@/arrange/types";
import { BoardContainer } from "@/boards/board-container";
import { useBoardMruStore } from "@/boards/board-mru-store";
import { BoardIconButton } from "@/boards/board-pane";
import { refreshLiveBoard, useBoard } from "@/boards/controller";
import { goBackFromBoard } from "@/boards/navigation";
import { openAddWorkspacePicker } from "@/boards/split-picker-store";
import {
  countVisibleBoardTabs,
  findBoardPane,
  resolveBoardViewport,
  resolvePaneActiveTabId,
} from "@/boards/screen-helpers";
import type { Board } from "@/boards/types";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useBoardKeyboard } from "@/boards/use-board-keyboard";
import { useBoardVisibleAgents } from "@/boards/use-board-visible-agents";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { WorkspaceExplorerToggle } from "@/screens/workspace/workspace-explorer-toggle";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useGlobalExplorerOpen } from "@/stores/global-sidebars-store";

const ThemedRefreshCw = withUnistyles(RefreshCw);

const REFRESH_ICON_SIZE = 14;
const NO_SHORTCUT_KEYS: ShortcutKey[] = [];

interface BoardScreenProps {
  boardId: string;
}

/**
 * A view of agent sessions from any workspaces and hosts, in split panes with tab strips.
 * Either a split of several workspaces (one pane each) or the Live view of every running agent.
 */
export function BoardScreen({ boardId }: BoardScreenProps) {
  const board = useBoard(boardId);
  const isFocused = useIsFocused();

  if (!board) {
    return <MissingBoard boardId={boardId} />;
  }
  return <BoardScreenContent board={board} isFocused={isFocused} />;
}

/** Top row of a view: sidebar toggle, an always-visible way back to the workspace, the title. */
function BoardHeader({
  boardId,
  title,
  rightContent,
}: {
  boardId: string;
  title?: string;
  rightContent?: ReactNode;
}) {
  const { t } = useTranslation();
  const handleBack = useCallback(() => {
    goBackFromBoard(boardId);
  }, [boardId]);
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          <Button
            variant="ghost"
            size="sm"
            leftIcon={ArrowLeft}
            onPress={handleBack}
            accessibilityLabel={t("boards.screen.back")}
            testID="board-back"
          >
            {t("boards.screen.back")}
          </Button>
          {title ? <ScreenTitle>{title}</ScreenTitle> : null}
        </>
      }
      right={rightContent}
      leftStyle={styles.headerLeft}
    />
  );
}

function MissingBoard({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <BoardHeader boardId={boardId} />
      <View style={styles.centered}>
        <Text style={styles.hint}>{t("boards.screen.notFound")}</Text>
      </View>
    </View>
  );
}

function LiveBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.liveBadge} testID="board-live-badge">
      <View style={styles.liveDot} />
      <Text style={styles.liveBadgeText}>{t("boards.screen.live")}</Text>
    </View>
  );
}

function BoardScreenContent({ board, isFocused }: { board: Board; isFocused: boolean }) {
  const { t } = useTranslation();
  const windowSize = useWindowDimensions();
  const measuredRef = useRef<ArrangeViewport | null>(null);
  const windowSizeRef = useRef<ArrangeViewport>({
    width: windowSize.width,
    height: windowSize.height,
  });
  windowSizeRef.current = { width: windowSize.width, height: windowSize.height };

  const handleViewportChange = useCallback((viewport: ArrangeViewport) => {
    measuredRef.current = viewport;
  }, []);
  const getViewport = useCallback(
    () =>
      resolveBoardViewport({ measured: measuredRef.current, windowSize: windowSizeRef.current }),
    [],
  );

  useBoardKeyboard({ board, enabled: isFocused, getViewport });
  useBoardSidebarKeys({ boardId: board.id, enabled: isFocused });
  // Without this the hosts never fetch or stream the timelines of agents shown here.
  useBoardVisibleAgents(board, isFocused);

  // The recent-tabs switcher orders a pane's tabs by use, so note what the focused pane shows.
  const focusedPaneId = board.layout.focusedPaneId;
  const activeTabId = useMemo(
    () => resolvePaneActiveTabId(findBoardPane(board.layout.root, focusedPaneId)),
    [board.layout.root, focusedPaneId],
  );
  const boardId = board.id;
  useEffect(() => {
    if (focusedPaneId && activeTabId) {
      useBoardMruStore.getState().record(boardId, focusedPaneId, activeTabId);
    }
  }, [activeTabId, boardId, focusedPaneId]);

  const handleRefresh = useCallback(() => refreshLiveBoard(getViewport()), [getViewport]);

  const isLive = board.kind === "live";
  // One remembered Files-explorer state for every workspace and view (board.explorerOpen is
  // kept in storage for compatibility but no longer read).
  const [explorerOpen, setExplorerOpen] = useGlobalExplorerOpen();
  const handleToggleExplorer = useCallback(
    () => setExplorerOpen(!explorerOpen),
    [explorerOpen, setExplorerOpen],
  );
  const handleAddWorkspace = useCallback(() => openAddWorkspacePicker(boardId), [boardId]);
  const explorerAccessibilityState = useMemo(() => ({ expanded: explorerOpen }), [explorerOpen]);
  const headerRight = useMemo(
    () => (
      <View style={styles.headerRight}>
        {isLive ? (
          <>
            <LiveBadge />
            <BoardIconButton
              label={t("boards.screen.refresh")}
              onPress={handleRefresh}
              testID="board-refresh"
            >
              <ThemedRefreshCw size={REFRESH_ICON_SIZE} uniProps={mutedIconColorMapping} />
            </BoardIconButton>
          </>
        ) : null}
        {isLive ? null : (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Plus}
            onPress={handleAddWorkspace}
            accessibilityLabel={t("boards.screen.addWorkspace")}
            testID="board-add-workspace"
          >
            {t("boards.screen.addWorkspace")}
          </Button>
        )}
        <WorkspaceExplorerToggle
          onPress={handleToggleExplorer}
          label={t(
            explorerOpen
              ? "workspace.tabs.explorerSidebar.close"
              : "workspace.tabs.explorerSidebar.open",
          )}
          tooltipLabel={t("workspace.tabs.explorerSidebar.toggle")}
          tooltipKeys={NO_SHORTCUT_KEYS}
          accessibilityState={explorerAccessibilityState}
          mobile={false}
        />
      </View>
    ),
    [
      explorerAccessibilityState,
      explorerOpen,
      handleAddWorkspace,
      handleRefresh,
      handleToggleExplorer,
      isLive,
      t,
    ],
  );

  const hasTabs = countVisibleBoardTabs(board.layout.root) > 0;

  return (
    <View style={styles.container} testID={`board-screen-${board.id}`}>
      <BoardHeader boardId={board.id} title={board.name} rightContent={headerRight} />
      {hasTabs ? (
        <DiffDocumentWorkspaceCacheProvider>
          <BoardContainer
            board={board}
            isScreenFocused={isFocused}
            onViewportChange={handleViewportChange}
          />
        </DiffDocumentWorkspaceCacheProvider>
      ) : (
        <View style={styles.centered} testID="board-empty">
          <Text style={styles.hint}>{t("boards.screen.emptyHint")}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  hint: {
    maxWidth: 420,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  headerLeft: {
    gap: theme.spacing[2],
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusSuccess,
  },
  liveBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

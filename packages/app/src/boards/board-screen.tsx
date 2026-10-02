import { useCallback, useEffect, useMemo, useRef } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RefreshCw } from "lucide-react-native";
import type { ArrangeViewport } from "@/arrange/types";
import { BoardContainer } from "@/boards/board-container";
import { useBoardMruStore } from "@/boards/board-mru-store";
import { BoardIconButton } from "@/boards/board-pane";
import { refreshLiveBoard, useBoard } from "@/boards/controller";
import {
  countVisibleBoardTabs,
  findBoardPane,
  resolveBoardViewport,
  resolvePaneActiveTabId,
} from "@/boards/screen-helpers";
import type { Board } from "@/boards/types";
import { useBoardKeyboard } from "@/boards/use-board-keyboard";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { MenuHeader } from "@/components/headers/menu-header";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";

const ThemedRefreshCw = withUnistyles(RefreshCw);

const REFRESH_ICON_SIZE = 14;

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
    return <MissingBoard />;
  }
  return <BoardScreenContent board={board} isFocused={isFocused} />;
}

function MissingBoard() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <MenuHeader />
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
  const headerRight = useMemo(
    () =>
      isLive ? (
        <View style={styles.headerRight}>
          <LiveBadge />
          <BoardIconButton
            label={t("boards.screen.refresh")}
            onPress={handleRefresh}
            testID="board-refresh"
          >
            <ThemedRefreshCw size={REFRESH_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </BoardIconButton>
        </View>
      ) : undefined,
    [handleRefresh, isLive, t],
  );

  const hasTabs = countVisibleBoardTabs(board.layout.root) > 0;

  return (
    <View style={styles.container} testID={`board-screen-${board.id}`}>
      <MenuHeader title={board.name} rightContent={headerRight} />
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

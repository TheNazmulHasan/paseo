import { memo, useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink, X } from "lucide-react-native";
import {
  fallbackBoardWorkspaceIdentity,
  type BoardWorkspaceIdentity,
  type BoardWorkspaceIdentityMap,
} from "@/boards/use-board-workspace-identity";
import { boardWorkspaceKey } from "@/boards/screen-helpers";
import type { BoardTabOrigin } from "@/boards/types";
import { ProjectIconView } from "@/components/project-icon-view";
import { shouldFocusPaneFromEventTarget } from "@/components/split-container-pane-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { WorkspacePanelHost } from "@/screens/workspace/workspace-panel-host";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SplitPane } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { RenderProfile } from "@/utils/render-profiler";

const ThemedX = withUnistyles(X);
const ThemedExternalLink = withUnistyles(ExternalLink);

const PROJECT_ICON_SIZE = 14;
const ACTION_ICON_SIZE = 14;

interface BoardIconButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  children: ReactElement;
}

/** Always-visible icon button with a tooltip. Boards never hide an action behind hover. */
export function BoardIconButton({ label, onPress, testID, children }: BoardIconButtonProps) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      iconButtonChromeStyle({ size: "small", state: { hovered: Boolean(hovered), pressed } }),
    [],
  );
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        style={buttonStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface BoardTabChipProps {
  paneId: string;
  tab: WorkspaceTabDescriptor;
  origin: BoardTabOrigin;
  identity: BoardWorkspaceIdentity;
  isActive: boolean;
  isPaneFocused: boolean;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

interface BoardTabChipBodyProps extends BoardTabChipProps {
  label: string;
}

function BoardTabChipBody({
  paneId,
  tab,
  identity,
  isActive,
  isPaneFocused,
  label,
  onSelectTab,
  onCloseTab,
}: BoardTabChipBodyProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    () => onSelectTab(paneId, tab.tabId),
    [onSelectTab, paneId, tab.tabId],
  );
  const handleClose = useCallback(() => onCloseTab(tab.tabId), [onCloseTab, tab.tabId]);
  const chipStyle = useMemo(() => {
    if (!isActive) {
      return [styles.tab];
    }
    return [styles.tab, isPaneFocused ? styles.tabActive : styles.tabActiveUnfocused];
  }, [isActive, isPaneFocused]);
  const labelStyle = useMemo(
    () => [styles.tabLabel, isActive ? styles.tabLabelActive : null],
    [isActive],
  );
  const selectStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tabSelect,
      hovered && !isActive ? styles.tabHovered : null,
    ],
    [isActive],
  );

  return (
    <View style={chipStyle} testID={`board-tab-${tab.tabId}`}>
      <Pressable
        onPress={handleSelect}
        style={selectStyle}
        accessibilityRole="button"
        accessibilityState={isActive ? SELECTED_STATE : UNSELECTED_STATE}
        accessibilityLabel={label}
      >
        <ProjectIconView
          iconDataUri={identity.iconDataUri}
          initial={identity.initial}
          projectViewKey={identity.projectViewKey}
          size={PROJECT_ICON_SIZE}
          textStyle={styles.projectIconText}
        />
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <BoardIconButton
        label={t("boards.screen.closeTab")}
        onPress={handleClose}
        testID={`board-tab-close-${tab.tabId}`}
      >
        <ThemedX size={ACTION_ICON_SIZE} uniProps={mutedIconColorMapping} />
      </BoardIconButton>
    </View>
  );
}

const SELECTED_STATE = { selected: true } as const;
const UNSELECTED_STATE = { selected: false } as const;

function BoardTabChip(props: BoardTabChipProps) {
  const { tab, origin } = props;
  const renderBody = useCallback(
    (presentation: { label: string }) => <BoardTabChipBody {...props} label={presentation.label} />,
    [props],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={tab}
      serverId={origin.serverId}
      workspaceId={origin.workspaceId}
    >
      {renderBody}
    </WorkspaceTabPresentationResolver>
  );
}

export interface BoardPaneProps {
  /** Scopes retained-tab bookkeeping; boards own no workspace of their own. */
  boardId: string;
  pane: SplitPane;
  allTabs: WorkspaceTab[];
  origins: Record<string, BoardTabOrigin>;
  identities: BoardWorkspaceIdentityMap;
  isFocused: boolean;
  isScreenFocused: boolean;
  onFocusPane: (paneId: string) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenInWorkspace: (origin: BoardTabOrigin) => void;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
}

const BOARD_HOST_SCOPE = "board";

/**
 * One pane of a board: a compact tab strip (project icon + session title, an always-visible ×),
 * a header line naming the active session's workspace with an "Open in workspace" icon, and the
 * session itself. Sessions render through the shared panel host, so the chat is the exact
 * AgentPanel a workspace mounts.
 */
export const BoardPane = memo(function BoardPane({
  boardId,
  pane,
  allTabs,
  origins,
  identities,
  isFocused,
  isScreenFocused,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onOpenInWorkspace,
  buildPaneContentModel,
}: BoardPaneProps) {
  const { t } = useTranslation();
  const paneRef = useRef<View | null>(null);
  const stableOnFocusPane = useStableEvent(onFocusPane);
  const paneId = pane.id;

  const paneState = useMemo(
    () => deriveWorkspacePaneState({ pane, tabs: allTabs }),
    [pane, allTabs],
  );
  // A tab without an origin cannot be mounted (it has no host or workspace to read from).
  const paneTabs = useMemo(
    () =>
      paneState.tabs
        .map((tab) => tab.descriptor)
        .filter((descriptor) => Boolean(origins[descriptor.tabId])),
    [origins, paneState.tabs],
  );
  const activeTab = useMemo(
    () => paneTabs.find((tab) => tab.tabId === paneState.activeTabId) ?? paneTabs[0] ?? null,
    [paneState.activeTabId, paneTabs],
  );
  const activeOrigin = activeTab ? (origins[activeTab.tabId] ?? null) : null;
  const activeIdentity = activeOrigin
    ? (identities.get(boardWorkspaceKey(activeOrigin)) ??
      fallbackBoardWorkspaceIdentity(activeOrigin.workspaceId))
    : null;

  useEffect(() => {
    if (isNative) {
      return () => {};
    }
    const rawRef: unknown = paneRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const paneElement = rawRef;
    const handlePointerDown = (event: PointerEvent) => {
      if (shouldFocusPaneFromEventTarget(event.target)) {
        stableOnFocusPane(paneId);
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (shouldFocusPaneFromEventTarget(event.target)) {
        stableOnFocusPane(paneId);
      }
    };
    paneElement.addEventListener("pointerdown", handlePointerDown, true);
    paneElement.addEventListener("focusin", handleFocusIn, true);
    return () => {
      paneElement.removeEventListener("pointerdown", handlePointerDown, true);
      paneElement.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [paneId, stableOnFocusPane]);

  const handleOpenInWorkspace = useCallback(() => {
    if (activeOrigin) {
      onOpenInWorkspace(activeOrigin);
    }
  }, [activeOrigin, onOpenInWorkspace]);

  return (
    <RenderProfile id={`BoardPane:${paneId}`}>
      <View ref={paneRef} collapsable={false} style={styles.pane} testID={`board-pane-${paneId}`}>
        <View style={styles.tabsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabsContent}
          >
            {paneTabs.map((tab) => {
              const origin = origins[tab.tabId];
              if (!origin) {
                return null;
              }
              return (
                <BoardTabChip
                  key={tab.tabId}
                  paneId={paneId}
                  tab={tab}
                  origin={origin}
                  identity={
                    identities.get(boardWorkspaceKey(origin)) ??
                    fallbackBoardWorkspaceIdentity(origin.workspaceId)
                  }
                  isActive={tab.tabId === activeTab?.tabId}
                  isPaneFocused={isFocused && isScreenFocused}
                  onSelectTab={onSelectTab}
                  onCloseTab={onCloseTab}
                />
              );
            })}
          </ScrollView>
        </View>

        {activeIdentity ? (
          <View style={styles.headerLine} testID={`board-pane-header-${paneId}`}>
            <ProjectIconView
              iconDataUri={activeIdentity.iconDataUri}
              initial={activeIdentity.initial}
              projectViewKey={activeIdentity.projectViewKey}
              size={PROJECT_ICON_SIZE}
              textStyle={styles.projectIconText}
            />
            <Text style={styles.headerWorkspaceName} numberOfLines={1}>
              {activeIdentity.workspaceName}
            </Text>
            <BoardIconButton
              label={t("boards.screen.openInWorkspace")}
              onPress={handleOpenInWorkspace}
              testID={`board-pane-open-${paneId}`}
            >
              <ThemedExternalLink size={ACTION_ICON_SIZE} uniProps={mutedIconColorMapping} />
            </BoardIconButton>
          </View>
        ) : null}

        <View style={styles.paneContent}>
          {activeTab ? (
            <WorkspacePanelHost
              paneId={paneId}
              tabs={paneTabs}
              activeTabId={activeTab.tabId}
              normalizedServerId={BOARD_HOST_SCOPE}
              normalizedWorkspaceId={boardId}
              isWorkspaceFocused={isScreenFocused}
              isPaneFocused={isFocused}
              onFocusPane={stableOnFocusPane}
              buildPaneContentModel={buildPaneContentModel}
            />
          ) : (
            <View style={styles.emptyPane}>
              <Text style={styles.emptyPaneText}>{t("boards.screen.paneEmpty")}</Text>
            </View>
          )}
        </View>
      </View>
    </RenderProfile>
  );
});

const styles = StyleSheet.create((theme) => ({
  pane: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  tabsRow: {
    minWidth: 0,
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
  },
  tabsScroll: {
    minWidth: 0,
    flex: 1,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
    gap: theme.spacing[1],
  },
  tab: {
    height: buttonControlHeight.xs,
    maxWidth: 220,
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[0.5],
    gap: theme.spacing[1],
    userSelect: "none",
  },
  tabActive: {
    backgroundColor: theme.colors.surface2,
  },
  tabActiveUnfocused: {
    backgroundColor: theme.colors.surface1,
  },
  tabHovered: {
    opacity: 0.8,
  },
  tabSelect: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  projectIconText: {
    fontSize: 9,
  },
  headerLine: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  headerWorkspaceName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  paneContent: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  emptyPane: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  emptyPaneText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));

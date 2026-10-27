import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink, Plus, X } from "lucide-react-native";
import { BoardPaneDragHandle, BoardPaneDropOverlay } from "@/boards/board-pane-dnd";
import { TopicTrailStrip } from "@/components/topic-trail/topic-trail-strip";
import {
  boardTabContextMenuTestId,
  buildBoardTabMenuEntries,
  resolveBoardTabsToClose,
  type BoardTabCloseScope,
} from "@/boards/board-tab-menu";
import {
  fallbackBoardWorkspaceIdentity,
  type BoardWorkspaceIdentity,
  type BoardWorkspaceIdentityMap,
} from "@/boards/use-board-workspace-identity";
import { boardWorkspaceKey, resolveActiveTabScrollX } from "@/boards/screen-helpers";
import type { BoardTabOrigin } from "@/boards/types";
import { ProjectIconView } from "@/components/project-icon-view";
import { shouldFocusPaneFromEventTarget } from "@/components/split-container-pane-focus";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useAgentTabActions } from "@/hooks/use-agent-tab-actions";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { AgentTabTooltipBody } from "@/screens/workspace/agent-tab-tooltip-body";
import { TabContextMenuItem } from "@/screens/workspace/workspace-desktop-tabs-row";
import { WorkspaceTabRenameModal } from "@/screens/workspace/use-workspace-tab-rename";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { WorkspacePanelHost } from "@/screens/workspace/workspace-panel-host";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabMenuLabels } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SplitPane } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { RenderProfile } from "@/utils/render-profiler";

const ThemedX = withUnistyles(X);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedPlus = withUnistyles(Plus);

const PROJECT_ICON_SIZE = 14;
const ACTION_ICON_SIZE = 14;

interface BoardIconButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  children: ReactElement;
}

/** Always-visible icon button with a tooltip. Boards never hide an action behind hover. */
export function BoardIconButton({
  label,
  onPress,
  testID,
  disabled,
  children,
}: BoardIconButtonProps) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      iconButtonChromeStyle({
        size: "small",
        state: { hovered: Boolean(hovered) && !disabled, pressed: pressed && !disabled },
      }),
      disabled ? styles.iconButtonDisabled : null,
    ],
    [disabled],
  );
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        disabled={disabled}
        style={buttonStyle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={disabled ? DISABLED_STATE : undefined}
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
  /** Position in the pane's tab strip; the right-click menu disables "close to the left" etc. from it. */
  index: number;
  tabCount: number;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseTabs: (tabId: string, scope: BoardTabCloseScope) => void;
  onRenameTab: (tab: WorkspaceTabDescriptor, origin: BoardTabOrigin) => void;
}

interface BoardTabChipBodyProps extends BoardTabChipProps {
  presentation: WorkspaceTabPresentation;
}

function useBoardTabMenuLabels(): WorkspaceTabMenuLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      agentSettings: t("workspace.tabs.menu.agentSettings"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
}

function BoardTabChipBody({
  paneId,
  tab,
  origin,
  identity,
  isActive,
  isPaneFocused,
  index,
  tabCount,
  presentation,
  onSelectTab,
  onCloseTab,
  onCloseTabs,
  onRenameTab,
}: BoardTabChipBodyProps) {
  const { t } = useTranslation();
  const { label } = presentation;
  const menuLabels = useBoardTabMenuLabels();
  const actions = useAgentTabActions(origin.serverId);
  const handleSelect = useCallback(
    () => onSelectTab(paneId, tab.tabId),
    [onSelectTab, paneId, tab.tabId],
  );
  const handleClose = useCallback(() => onCloseTab(tab.tabId), [onCloseTab, tab.tabId]);
  const menuEntries = useMemo(
    () =>
      buildBoardTabMenuEntries({
        tab,
        index,
        tabCount,
        labels: menuLabels,
        onCopyResumeCommand: actions.copyResumeCommand,
        onCopyAgentId: actions.copyAgentId,
        onCopyFilePath: actions.copyFilePath,
        onReloadAgent: actions.reloadAgent,
        onRenameTab: (renamed) => onRenameTab(renamed, origin),
        onCloseTab,
        onCloseTabsBefore: (tabId) => onCloseTabs(tabId, "before"),
        onCloseTabsAfter: (tabId) => onCloseTabs(tabId, "after"),
        onCloseOtherTabs: (tabId) => onCloseTabs(tabId, "others"),
      }),
    [actions, index, menuLabels, onCloseTab, onCloseTabs, onRenameTab, origin, tab, tabCount],
  );
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
  const agentId = tab.target.kind === "agent" ? tab.target.agentId : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly style={chipStyle} testID={`board-tab-${tab.tabId}`}>
        <Tooltip
          delayDuration={400}
          enabledOnDesktop
          enabledOnMobile={false}
          interactive={agentId !== null}
        >
          <TooltipTrigger asChild triggerRefProp="ref">
            <Pressable
              onPress={handleSelect}
              style={selectStyle}
              accessibilityRole="button"
              accessibilityState={isActive ? SELECTED_STATE : UNSELECTED_STATE}
              accessibilityLabel={label}
            >
              {tab.kind === "file" ? (
                // A file has no project of its own: it shows the file-type icon the workspace strip uses.
                <WorkspaceTabIcon
                  presentation={presentation}
                  active={isActive}
                  size={PROJECT_ICON_SIZE}
                  backdrop={isActive ? "surface2" : "surface0"}
                />
              ) : (
                <ProjectIconView
                  iconDataUri={identity.iconDataUri}
                  initial={identity.initial}
                  projectViewKey={identity.projectViewKey}
                  size={PROJECT_ICON_SIZE}
                  textStyle={styles.projectIconText}
                />
              )}
              <Text style={labelStyle} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="center"
            offset={8}
            maxWidth={720}
            testID={`board-tab-tooltip-${tab.tabId}`}
          >
            {agentId !== null ? (
              <AgentTabTooltipBody serverId={origin.serverId} agentId={agentId} title={label} />
            ) : (
              <Text style={styles.tooltipText}>{label}</Text>
            )}
          </TooltipContent>
        </Tooltip>
        <BoardIconButton
          label={t("boards.screen.closeTab")}
          onPress={handleClose}
          testID={`board-tab-close-${tab.tabId}`}
        >
          <ThemedX size={ACTION_ICON_SIZE} uniProps={mutedIconColorMapping} />
        </BoardIconButton>
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={BOARD_TAB_MENU_WIDTH}
        testID={boardTabContextMenuTestId(tab.tabId)}
      >
        {menuEntries.map((entry) =>
          entry.kind === "separator" ? (
            <ContextMenuSeparator key={entry.key} />
          ) : (
            <TabContextMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const BOARD_TAB_MENU_WIDTH = 220;
const DISABLED_STATE = { disabled: true } as const;
const SELECTED_STATE = { selected: true } as const;
const UNSELECTED_STATE = { selected: false } as const;

function BoardTabChip(props: BoardTabChipProps) {
  const { tab, origin } = props;
  const renderBody = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <BoardTabChipBody {...props} presentation={presentation} />
    ),
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

interface BoardRenamingAgent {
  serverId: string;
  agentId: string;
  currentTitle: string;
}

/** The rename dialog of a view tab: a session on any host, so it talks to that tab's own host. */
function BoardAgentRenameModal({
  renaming,
  onClose,
}: {
  renaming: BoardRenamingAgent;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(renaming.serverId);
  const queryClient = useQueryClient();
  const renamingTab = useMemo(
    () => ({ kind: "agent" as const, id: renaming.agentId, currentTitle: renaming.currentTitle }),
    [renaming.agentId, renaming.currentTitle],
  );
  const handleSubmit = useCallback(
    async (nextTitle: string) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      await client.updateAgent(renaming.agentId, { name: nextTitle.trim() });
      void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", renaming.serverId] });
      void queryClient.invalidateQueries({ queryKey: ["allAgents", renaming.serverId] });
    },
    [client, queryClient, renaming.agentId, renaming.serverId, t],
  );
  return (
    <WorkspaceTabRenameModal renamingTab={renamingTab} onClose={onClose} onSubmit={handleSubmit} />
  );
}

/** Reports a chip's position inside the strip so the pane can scroll the active one into view. */
function BoardTabChipSlot({
  tabId,
  onChipLayout,
  children,
}: {
  tabId: string;
  onChipLayout: (tabId: string, layout: { x: number; width: number }) => void;
  children: ReactElement;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      onChipLayout(tabId, { x, width });
    },
    [onChipLayout, tabId],
  );
  return (
    <View collapsable={false} onLayout={handleLayout}>
      {children}
    </View>
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
  /** Opens a draft ("New agent") as a tab in this pane. */
  onNewAgent: (paneId: string) => void;
  /** Takes this pane (its workspace) out of the view; absent on the Live view (no icon). */
  onRemoveWorkspace?: (paneId: string) => void;
  /** False on the view's last pane: the icon stays but is disabled. */
  canRemove: boolean;
  /** False while the board shows a single pane: nothing to drag onto. */
  dragEnabled: boolean;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
}

const BOARD_HOST_SCOPE = "board";

/**
 * One pane of a board: a header line naming the pane's workspace (drag grip, "Open in
 * workspace", "Remove from view"), a compact tab strip below it (project icon + session title,
 * an always-visible ×, "+" for a new agent) that keeps the active tab in view, and the session
 * itself. Sessions render through the shared panel host, so the chat is the exact
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
  onNewAgent,
  onRemoveWorkspace,
  canRemove,
  dragEnabled,
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

  const paneTabIds = useMemo(() => paneTabs.map((tab) => tab.tabId), [paneTabs]);
  const handleCloseTabs = useCallback(
    (tabId: string, scope: BoardTabCloseScope) => {
      for (const id of resolveBoardTabsToClose(paneTabIds, tabId, scope)) {
        onCloseTab(id);
      }
    },
    [onCloseTab, paneTabIds],
  );
  const [renaming, setRenaming] = useState<BoardRenamingAgent | null>(null);
  const handleRenameTab = useCallback((tab: WorkspaceTabDescriptor, origin: BoardTabOrigin) => {
    if (tab.target.kind !== "agent") {
      return;
    }
    const { agentId } = tab.target;
    const agent = useSessionStore.getState().sessions[origin.serverId]?.agents?.get(agentId);
    setRenaming({ serverId: origin.serverId, agentId, currentTitle: agent?.title ?? "" });
  }, []);
  const handleRenameClose = useCallback(() => setRenaming(null), []);

  const handleNewAgent = useCallback(() => onNewAgent(paneId), [onNewAgent, paneId]);
  const handleRemoveWorkspace = useCallback(
    () => onRemoveWorkspace?.(paneId),
    [onRemoveWorkspace, paneId],
  );

  // Keep the active chip in view: scroll when it changes, when it is first measured, and when
  // the strip is resized. Everything is read from refs so the callbacks stay stable.
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollXRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const chipLayoutsRef = useRef(new Map<string, { x: number; width: number }>());
  const activeTabIdRef = useRef<string | null>(null);
  const activeTabId = activeTab?.tabId ?? null;
  activeTabIdRef.current = activeTabId;
  const revealActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    const chip = id ? chipLayoutsRef.current.get(id) : undefined;
    if (!chip) {
      return;
    }
    const x = resolveActiveTabScrollX({
      scrollX: scrollXRef.current,
      viewportWidth: viewportWidthRef.current,
      tabX: chip.x,
      tabWidth: chip.width,
    });
    if (x !== null) {
      scrollXRef.current = x;
      scrollRef.current?.scrollTo({ x, animated: false });
    }
  }, []);
  useEffect(() => {
    revealActiveTab();
  }, [activeTabId, revealActiveTab]);
  const handleStripLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width;
      revealActiveTab();
    },
    [revealActiveTab],
  );
  const handleStripScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = event.nativeEvent.contentOffset.x;
  }, []);
  const handleChipLayout = useCallback(
    (tabId: string, layout: { x: number; width: number }) => {
      chipLayoutsRef.current.set(tabId, layout);
      if (tabId === activeTabIdRef.current) {
        revealActiveTab();
      }
    },
    [revealActiveTab],
  );

  return (
    <RenderProfile id={`BoardPane:${paneId}`}>
      <View ref={paneRef} collapsable={false} style={styles.pane} testID={`board-pane-${paneId}`}>
        <View style={styles.headerLine} testID={`board-pane-header-${paneId}`}>
          {dragEnabled ? (
            <BoardPaneDragHandle paneId={paneId} label={t("boards.screen.dragPane")} />
          ) : null}
          {activeIdentity ? (
            <>
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
            </>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          {onRemoveWorkspace ? (
            <BoardIconButton
              label={t("boards.screen.removeWorkspace")}
              onPress={handleRemoveWorkspace}
              disabled={!canRemove}
              testID={`board-pane-remove-${paneId}`}
            >
              <ThemedX size={ACTION_ICON_SIZE} uniProps={mutedIconColorMapping} />
            </BoardIconButton>
          ) : null}
        </View>

        <View style={styles.tabsRow}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabsContent}
            onLayout={handleStripLayout}
            onScroll={handleStripScroll}
            scrollEventThrottle={16}
          >
            {paneTabs.map((tab, index) => {
              const origin = origins[tab.tabId];
              if (!origin) {
                return null;
              }
              return (
                <BoardTabChipSlot key={tab.tabId} tabId={tab.tabId} onChipLayout={handleChipLayout}>
                  <BoardTabChip
                    paneId={paneId}
                    tab={tab}
                    origin={origin}
                    identity={
                      identities.get(boardWorkspaceKey(origin)) ??
                      fallbackBoardWorkspaceIdentity(origin.workspaceId)
                    }
                    isActive={tab.tabId === activeTab?.tabId}
                    isPaneFocused={isFocused && isScreenFocused}
                    index={index}
                    tabCount={paneTabs.length}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onCloseTabs={handleCloseTabs}
                    onRenameTab={handleRenameTab}
                  />
                </BoardTabChipSlot>
              );
            })}
          </ScrollView>
          <BoardIconButton
            label={t("boards.screen.newAgentInPane")}
            onPress={handleNewAgent}
            testID={`board-pane-new-agent-${paneId}`}
          >
            <ThemedPlus size={ACTION_ICON_SIZE} uniProps={mutedIconColorMapping} />
          </BoardIconButton>
        </View>

        <TopicTrailStrip serverId={activeOrigin?.serverId ?? null} tab={activeTab} />

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
        {dragEnabled ? <BoardPaneDropOverlay paneId={paneId} /> : null}
        {renaming ? (
          <BoardAgentRenameModal renaming={renaming} onClose={handleRenameClose} />
        ) : null}
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
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT - 4,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  headerSpacer: {
    flex: 1,
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
  iconButtonDisabled: {
    opacity: 0.35,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));

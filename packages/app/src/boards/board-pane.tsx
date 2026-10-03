import { memo, useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
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
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink, Plus, X } from "lucide-react-native";
import { BoardPaneDragHandle, BoardPaneDropOverlay } from "@/boards/board-pane-dnd";
import {
  fallbackBoardWorkspaceIdentity,
  type BoardWorkspaceIdentity,
  type BoardWorkspaceIdentityMap,
} from "@/boards/use-board-workspace-identity";
import { boardWorkspaceKey, resolveActiveTabScrollX } from "@/boards/screen-helpers";
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
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
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
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

interface BoardTabChipBodyProps extends BoardTabChipProps {
  presentation: WorkspaceTabPresentation;
}

function BoardTabChipBody({
  paneId,
  tab,
  identity,
  isActive,
  isPaneFocused,
  presentation,
  onSelectTab,
  onCloseTab,
}: BoardTabChipBodyProps) {
  const { t } = useTranslation();
  const { label } = presentation;
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
            {paneTabs.map((tab) => {
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
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
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

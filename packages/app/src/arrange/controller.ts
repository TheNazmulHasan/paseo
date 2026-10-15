/**
 * Arrange controller (fork mod #11). Signatures are the contract the UI codes
 * against; every function takes the workspace key from buildWorkspaceTabPersistenceKey
 * and is a no-op returning false/null when the workspace has no layout.
 *
 * The rules (what moves where) live in model.ts; this file reads the stores,
 * calls the model, and writes the result back through one atomic layout action.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  getArrangeWorkspaceState,
  EMPTY_ARRANGE_WORKSPACE_STATE,
  useArrangeStore,
  type ArrangeWorkspaceState,
  type SplitSizeOverrides,
} from "@/arrange/arrange-store";
import {
  arrangeLayoutTabs,
  collectArrangeTabs,
  equalizeLayout,
  pruneSplitSizes,
  reconcileSnapshot,
} from "@/arrange/model";
import { getArrangeSelection, useArrangeSelectionStore } from "@/arrange/selection-store";
import type { ArrangePreset, ArrangeViewport, NamedLayoutSummary } from "@/arrange/types";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  findPaneById,
  normalizeLayout,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/** A burst of agents starting together should produce one re-arrange, not one each. */
const WATCH_DEBOUNCE_MS = 300;

const NO_NAMED_LAYOUTS: readonly NamedLayoutSummary[] = [];

const CLEARED_RUN: Partial<ArrangeWorkspaceState> = {
  snapshot: null,
  lastPreset: null,
  watchActive: false,
  watchedAgentIds: [],
};

interface WorkspaceView {
  layout: WorkspaceLayout;
  splitSizes: SplitSizeOverrides;
  explorerPaneId: string | null;
}

function readWorkspace(workspaceKey: string): WorkspaceView | null {
  const state = useWorkspaceLayoutStore.getState();
  const stored = state.layoutByWorkspace[workspaceKey];
  if (!stored) {
    return null;
  }
  return {
    layout: normalizeLayout(stored),
    splitSizes: state.splitSizesByWorkspace[workspaceKey] ?? {},
    explorerPaneId: selectExplorerSidebarPaneId(state, workspaceKey),
  };
}

function applyLayout(
  workspaceKey: string,
  layout: WorkspaceLayout,
  splitSizes: SplitSizeOverrides,
): void {
  useWorkspaceLayoutStore.getState().applyArrangedLayout(workspaceKey, layout, splitSizes);
}

function patchArrangeState(workspaceKey: string, patch: Partial<ArrangeWorkspaceState>): void {
  useArrangeStore.getState().patchWorkspace(workspaceKey, patch);
}

/**
 * The restore point of a run. Only the first arrange of a run saves one, so pressing
 * different presets in a row still restores to the layout the user had before any of them.
 */
function snapshotFor(workspaceKey: string, before: WorkspaceView) {
  return (
    getArrangeWorkspaceState(workspaceKey).snapshot ?? {
      layout: before.layout,
      splitSizes: before.splitSizes,
    }
  );
}

function openAgentTab(workspaceKey: string, agentId: string): string | null {
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey,
    target: { kind: "agent", agentId },
    // Opening is not visiting: the arrange that follows decides what is on show.
    intent: "background",
  });
}

function splitWorkspaceKey(workspaceKey: string): { serverId: string; workspaceId: string } | null {
  const separator = workspaceKey.indexOf(":");
  if (separator <= 0 || separator === workspaceKey.length - 1) {
    return null;
  }
  return {
    serverId: workspaceKey.slice(0, separator),
    workspaceId: workspaceKey.slice(separator + 1),
  };
}

function createNamedLayoutId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `arrange_${value}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// Agent status, the way the sidebar reads it: an open turn is what makes an agent
// running (utils/workspace-agent-activity.ts), and isSidebarActiveAgent is its
// "needs a look" test (running, needs input, failed, or finished and unread).
interface WatchCandidate {
  agentId: string;
  /** Running or needing attention: worth a pane if its tab is already open. */
  active: boolean;
  /** Actually working right now: worth opening a tab for. */
  running: boolean;
}

function listWatchCandidates(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): WatchCandidate[] {
  if (!agents) {
    return [];
  }
  const wanted = normalizeWorkspaceOpaqueId(workspaceId);
  const candidates: WatchCandidate[] = [];
  for (const agent of agents.values()) {
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (
      agent.archivedAt ||
      normalizeWorkspaceOpaqueId(agent.workspaceId) !== wanted ||
      !isWorkspaceRootAgent(agent, parent)
    ) {
      continue;
    }
    let status = agent.status;
    if (agent.turn.phase === "open") {
      status = "running";
    } else if (agent.status === "running") {
      status = "idle";
    }
    const active = isSidebarActiveAgent({
      status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    candidates.push({ agentId: agent.id, active, running: status === "running" });
  }
  return candidates;
}

function readWatchCandidates(workspaceKey: string): WatchCandidate[] {
  const parsed = splitWorkspaceKey(workspaceKey);
  if (!parsed) {
    return [];
  }
  const agents = useSessionStore.getState().sessions[parsed.serverId]?.agents;
  return listWatchCandidates(agents, parsed.workspaceId);
}

function agentTabIds(view: WorkspaceView): Map<string, string> {
  const byAgent = new Map<string, string>();
  for (const tab of collectArrangeTabs(view.layout, view.explorerPaneId)) {
    if (tab.target.kind === "agent" && !byAgent.has(tab.target.agentId)) {
      byAgent.set(tab.target.agentId, tab.tabId);
    }
  }
  return byAgent;
}

/**
 * Who deserves a pane: an open agent tab if its agent is running or needs attention,
 * a closed one only if its agent is actually running. Open tabs keep their layout order.
 */
function pickWatchedAgentIds(candidates: WatchCandidate[], open: Map<string, string>): string[] {
  const byId = new Map(candidates.map((candidate) => [candidate.agentId, candidate]));
  const picked: string[] = [];
  for (const agentId of open.keys()) {
    if (byId.get(agentId)?.active) {
      picked.push(agentId);
    }
  }
  for (const candidate of candidates) {
    if (!open.has(candidate.agentId) && candidate.running) {
      picked.push(candidate.agentId);
    }
  }
  return picked;
}

/** Arrange the selection (or every session) into `preset`. Same preset twice in a row restores. */
export function arrangeWorkspace(input: {
  workspaceKey: string;
  preset: ArrangePreset;
  viewport: ArrangeViewport;
}): boolean {
  const { workspaceKey, preset, viewport } = input;
  const before = readWorkspace(workspaceKey);
  if (!before) {
    return false;
  }
  const arrange = getArrangeWorkspaceState(workspaceKey);
  if (arrange.lastPreset === preset && arrange.snapshot) {
    return restoreWorkspaceArrangement(workspaceKey);
  }

  const selection = getArrangeSelection(workspaceKey);
  // Sidebar picks that are not open yet become tabs first, so they can be arranged.
  const openedTabIds = selection.agentIds.flatMap((agentId) => {
    const tabId = openAgentTab(workspaceKey, agentId);
    return tabId ? [tabId] : [];
  });
  const current = readWorkspace(workspaceKey) ?? before;
  const openTabIds = collectArrangeTabs(current.layout, current.explorerPaneId).map(
    (tab) => tab.tabId,
  );
  const open = new Set(openTabIds);
  const selected = unique([...selection.tabIds, ...openedTabIds]).filter((id) => open.has(id));
  const tabIds = selected.length > 0 ? selected : openTabIds;

  const arranged = arrangeLayoutTabs(current.layout, {
    tabIds,
    preset,
    viewport,
    explorerPaneId: current.explorerPaneId,
  });
  if (!arranged) {
    return false;
  }
  const snapshot = snapshotFor(workspaceKey, before);
  applyLayout(workspaceKey, arranged, {});
  patchArrangeState(workspaceKey, {
    snapshot,
    lastPreset: preset,
    watchActive: false,
    watchedAgentIds: [],
  });
  useArrangeSelectionStore.getState().clear(workspaceKey);
  return true;
}

/** Grid of the agents that are running or need attention; pressing again restores. */
export function toggleWatchMode(input: {
  workspaceKey: string;
  viewport: ArrangeViewport;
}): boolean {
  const { workspaceKey, viewport } = input;
  const arrange = getArrangeWorkspaceState(workspaceKey);
  if (arrange.watchActive) {
    if (!restoreWorkspaceArrangement(workspaceKey)) {
      // Watch was on but there is nothing to put back; just switch it off.
      patchArrangeState(workspaceKey, CLEARED_RUN);
    }
    return true;
  }

  const before = readWorkspace(workspaceKey);
  if (!before) {
    return false;
  }
  const open = agentTabIds(before);
  const watched = pickWatchedAgentIds(readWatchCandidates(workspaceKey), open);
  if (watched.length === 0) {
    return false;
  }

  for (const agentId of watched) {
    if (!open.has(agentId)) {
      const tabId = openAgentTab(workspaceKey, agentId);
      if (tabId) {
        open.set(agentId, tabId);
      }
    }
  }
  const current = readWorkspace(workspaceKey) ?? before;
  const watchedTabIds = watched.flatMap((agentId) => {
    const tabId = open.get(agentId);
    return tabId ? [tabId] : [];
  });
  const arranged = arrangeLayoutTabs(current.layout, {
    tabIds: watchedTabIds,
    preset: "grid",
    viewport,
    explorerPaneId: current.explorerPaneId,
  });
  if (!arranged) {
    return false;
  }
  const snapshot = snapshotFor(workspaceKey, before);
  applyLayout(workspaceKey, arranged, {});
  patchArrangeState(workspaceKey, {
    snapshot,
    lastPreset: "watch",
    watchActive: true,
    watchedAgentIds: watched,
  });
  return true;
}

/**
 * Watch mode's live step: agents that started working since the grid was made join it.
 * The restore snapshot is not touched, so Restore still goes back to before Watch.
 * Finished agents are never removed here; they stay until the user leaves Watch.
 */
export function extendWatchGrid(input: {
  workspaceKey: string;
  viewport: ArrangeViewport;
}): boolean {
  const { workspaceKey, viewport } = input;
  const arrange = getArrangeWorkspaceState(workspaceKey);
  const before = readWorkspace(workspaceKey);
  if (!arrange.watchActive || !before) {
    return false;
  }
  const open = agentTabIds(before);
  const known = new Set(arrange.watchedAgentIds);
  const joining = pickWatchedAgentIds(readWatchCandidates(workspaceKey), open).filter(
    (agentId) => !known.has(agentId),
  );
  if (joining.length === 0) {
    return false;
  }

  for (const agentId of joining) {
    if (!open.has(agentId)) {
      const tabId = openAgentTab(workspaceKey, agentId);
      if (tabId) {
        open.set(agentId, tabId);
      }
    }
  }
  const current = readWorkspace(workspaceKey) ?? before;
  const layoutOrder = collectArrangeTabs(current.layout, current.explorerPaneId).map(
    (tab) => tab.tabId,
  );
  const watchedTabIds = new Set(
    arrange.watchedAgentIds.flatMap((agentId) => {
      const tabId = open.get(agentId);
      return tabId ? [tabId] : [];
    }),
  );
  // Watched tabs keep the order they have on screen; newcomers follow.
  const ordered = [
    ...layoutOrder.filter((tabId) => watchedTabIds.has(tabId)),
    ...joining.flatMap((agentId) => {
      const tabId = open.get(agentId);
      return tabId ? [tabId] : [];
    }),
  ];
  const arranged = arrangeLayoutTabs(current.layout, {
    tabIds: ordered,
    preset: "grid",
    viewport,
    explorerPaneId: current.explorerPaneId,
  });
  if (!arranged) {
    return false;
  }
  applyLayout(workspaceKey, arranged, {});
  const joined = joining.filter((agentId) => open.has(agentId));
  const stillOpen = arrange.watchedAgentIds.filter((agentId) => open.has(agentId));
  patchArrangeState(workspaceKey, { watchedAgentIds: [...stillOpen, ...joined] });
  return true;
}

/** Brings a saved layout up to the tabs that exist now, with the Explorer exactly as it is. */
function reconcileForApply(view: WorkspaceView, saved: WorkspaceLayout): WorkspaceLayout {
  return reconcileSnapshot(saved, collectArrangeTabs(view.layout, view.explorerPaneId), {
    explorerPaneId: view.explorerPaneId,
    currentExplorerPane: view.explorerPaneId
      ? findPaneById(view.layout.root, view.explorerPaneId)
      : null,
  });
}

/** Put back the layout from before the last arrange (sizes included). */
export function restoreWorkspaceArrangement(workspaceKey: string): boolean {
  const view = readWorkspace(workspaceKey);
  const { snapshot } = getArrangeWorkspaceState(workspaceKey);
  if (!view || !snapshot) {
    return false;
  }
  const restored = reconcileForApply(view, snapshot.layout);
  applyLayout(workspaceKey, restored, pruneSplitSizes(restored, snapshot.splitSizes));
  patchArrangeState(workspaceKey, CLEARED_RUN);
  return true;
}

export function equalizeWorkspacePanes(workspaceKey: string): boolean {
  const view = readWorkspace(workspaceKey);
  if (!view) {
    return false;
  }
  // Dragged dividers live in split-size overrides; clearing them is what makes it equal.
  applyLayout(workspaceKey, equalizeLayout(view.layout, view.explorerPaneId), {});
  return true;
}

export function saveNamedLayout(workspaceKey: string, name: string): string | null {
  const trimmed = name.trim();
  const view = readWorkspace(workspaceKey);
  if (!trimmed || !view) {
    return null;
  }
  const { namedLayouts } = getArrangeWorkspaceState(workspaceKey);
  // Saving under an existing name updates that layout instead of piling up twins.
  const existing = namedLayouts.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  const id = existing?.id ?? createNamedLayoutId();
  useArrangeStore.getState().upsertNamedLayout(workspaceKey, {
    id,
    name: trimmed,
    savedAt: Date.now(),
    layout: view.layout,
    splitSizes: view.splitSizes,
  });
  return id;
}

export function applyNamedLayout(workspaceKey: string, layoutId: string): boolean {
  const view = readWorkspace(workspaceKey);
  const named = getArrangeWorkspaceState(workspaceKey).namedLayouts.find(
    (entry) => entry.id === layoutId,
  );
  if (!view || !named) {
    return false;
  }
  // Like an arrange: remember where the user was (unless a run already did), so Restore works.
  const snapshot = snapshotFor(workspaceKey, view);
  const applied = reconcileForApply(view, named.layout);
  applyLayout(workspaceKey, applied, pruneSplitSizes(applied, named.splitSizes));
  patchArrangeState(workspaceKey, {
    snapshot,
    lastPreset: null,
    watchActive: false,
    watchedAgentIds: [],
  });
  return true;
}

export function deleteNamedLayout(workspaceKey: string, layoutId: string): void {
  useArrangeStore.getState().removeNamedLayout(workspaceKey, layoutId);
}

export function useNamedLayouts(workspaceKey: string | null): readonly NamedLayoutSummary[] {
  const namedLayouts = useArrangeStore((state) =>
    workspaceKey ? state.byWorkspace[workspaceKey]?.namedLayouts : undefined,
  );
  return useMemo(
    () =>
      namedLayouts && namedLayouts.length > 0
        ? namedLayouts.map(({ id, name, savedAt }) => ({ id, name, savedAt }))
        : NO_NAMED_LAYOUTS,
    [namedLayouts],
  );
}

/** True when there is a snapshot to restore (drives the menu's Restore item). */
export function useCanRestoreArrangement(workspaceKey: string | null): boolean {
  return useArrangeStore((state) =>
    workspaceKey
      ? (state.byWorkspace[workspaceKey] ?? EMPTY_ARRANGE_WORKSPACE_STATE).snapshot !== null
      : false,
  );
}

/** True while Watch mode is on for this workspace. */
export function useWatchModeActive(workspaceKey: string | null): boolean {
  return useArrangeStore((state) =>
    workspaceKey ? (state.byWorkspace[workspaceKey]?.watchActive ?? false) : false,
  );
}

/**
 * Mount once in the workspace screen. While Watch mode is on, an agent that
 * starts running (or starts needing attention) joins the grid; finished agents
 * stay put until the user presses Watch again.
 */
export function useLiveWatch(workspaceKey: string | null, viewport: ArrangeViewport | null): void {
  const watchActive = useWatchModeActive(workspaceKey);
  const parsed = useMemo(
    () => (workspaceKey ? splitWorkspaceKey(workspaceKey) : null),
    [workspaceKey],
  );
  // A string, not a list: the store notifies on every agent update, and only a change in
  // WHO is working may restart the debounce.
  const activeAgentsKey = useSessionStore((state) =>
    parsed
      ? listWatchCandidates(state.sessions[parsed.serverId]?.agents, parsed.workspaceId)
          .filter((candidate) => candidate.active)
          .map((candidate) => candidate.agentId)
          .sort()
          .join("\n")
      : "",
  );
  // Resizing the window must not re-run the effect; the latest size is read when the timer fires.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const hasViewport = viewport !== null;

  useEffect(() => {
    if (!workspaceKey || !watchActive || !hasViewport || activeAgentsKey === "") {
      return;
    }
    const timer = setTimeout(() => {
      const latest = viewportRef.current;
      if (latest) {
        extendWatchGrid({ workspaceKey, viewport: latest });
      }
    }, WATCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspaceKey, watchActive, hasViewport, activeAgentsKey]);
}

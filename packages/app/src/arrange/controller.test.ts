/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { getArrangeWorkspaceState, useArrangeStore } from "@/arrange/arrange-store";
import {
  applyNamedLayout,
  arrangeWorkspace,
  deleteNamedLayout,
  equalizeWorkspacePanes,
  extendWatchGrid,
  restoreWorkspaceArrangement,
  saveNamedLayout,
  toggleWatchMode,
  useCanRestoreArrangement,
  useLiveWatch,
  useNamedLayouts,
  useWatchModeActive,
} from "@/arrange/controller";
import { getArrangeSelection, useArrangeSelectionStore } from "@/arrange/selection-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  collectAllPanes,
  collectAllTabs,
  createWorkspaceLayoutWithExplorerSidebar,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "ws-1";
const KEY = buildWorkspaceTabPersistenceKey({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID })!;
const VIEWPORT = { width: 1800, height: 1100 };

type AgentState = "idle" | "running" | "attention";

function agent(id: string, state: AgentState, workspaceId = WORKSPACE_ID): Agent {
  return {
    id,
    serverId: SERVER_ID,
    status: state === "running" ? "running" : "idle",
    turn:
      state === "running"
        ? { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null }
        : { phase: "idle", cancellationRequestId: null },
    pendingPermissions: [],
    requiresAttention: state === "attention",
    attentionReason: state === "attention" ? "finished" : null,
    archivedAt: null,
    parentAgentId: null,
    workspaceId,
  } as unknown as Agent;
}

function setAgents(states: Record<string, AgentState>, workspaceId = WORKSPACE_ID): void {
  const agents = new Map(
    Object.entries(states).map(([id, state]) => [id, agent(id, state, workspaceId)]),
  );
  useSessionStore.setState({ sessions: { [SERVER_ID]: { agents } } } as never);
}

function openAgent(agentId: string): string {
  const tabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: KEY,
    target: { kind: "agent", agentId },
    intent: "background",
  });
  if (!tabId) {
    throw new Error(`could not open ${agentId}`);
  }
  return tabId;
}

function seedWorkspace(agentIds: string[]): string[] {
  useWorkspaceLayoutStore.setState((state) => ({
    layoutByWorkspace: {
      ...state.layoutByWorkspace,
      [KEY]: createWorkspaceLayoutWithExplorerSidebar(),
    },
  }));
  return agentIds.map(openAgent);
}

function layout() {
  const stored = useWorkspaceLayoutStore.getState().layoutByWorkspace[KEY];
  if (!stored) {
    throw new Error("no layout");
  }
  return stored;
}

function mainPanes() {
  return collectAllPanes(layout().root).filter((pane) => pane.id !== "explorer");
}

/** Tab ids per pane, in on-screen order, as plain agent ids. */
function paneAgents(): string[][] {
  const tabs = new Map(collectAllTabs(layout().root).map((tab) => [tab.tabId, tab]));
  return mainPanes().map((pane) =>
    pane.tabIds.map((tabId) => {
      const target = tabs.get(tabId)?.target;
      return target?.kind === "agent" ? target.agentId : tabId;
    }),
  );
}

function allMainAgents(): string[] {
  return paneAgents().flat().sort();
}

function arrange(preset: "single" | "columns-2" | "columns-3" | "grid") {
  return arrangeWorkspace({ workspaceKey: KEY, preset, viewport: VIEWPORT });
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    splitSizesByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    pinnedAgentIdsByWorkspace: {},
    hiddenAgentIdsByWorkspace: {},
  });
  useArrangeStore.setState({ byWorkspace: {} });
  useArrangeSelectionStore.setState({ byWorkspace: {} });
  setAgents({});
});

afterEach(() => {
  // No test globals here, so testing-library does not unmount hooks on its own.
  cleanup();
  vi.useRealTimers();
});

describe("without a layout", () => {
  it("every action is a no-op", () => {
    expect(arrange("grid")).toBe(false);
    expect(toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(false);
    expect(restoreWorkspaceArrangement(KEY)).toBe(false);
    expect(equalizeWorkspacePanes(KEY)).toBe(false);
    expect(saveNamedLayout(KEY, "x")).toBeNull();
    expect(applyNamedLayout(KEY, "nope")).toBe(false);
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace).toEqual({});
    expect(useArrangeStore.getState().byWorkspace).toEqual({});
  });
});

describe("arrangeWorkspace", () => {
  it("arranges every session when nothing is selected", () => {
    seedWorkspace(["a1", "a2", "a3", "a4"]);
    expect(arrange("columns-2")).toBe(true);
    expect(paneAgents()).toEqual([
      ["a1", "a2"],
      ["a3", "a4"],
    ]);
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBe("columns-2");
  });

  it("pressing the same preset again restores the original layout", () => {
    seedWorkspace(["a1", "a2", "a3", "a4"]);
    const originalRoot = layout().root;
    expect(arrange("grid")).toBe(true);
    expect(mainPanes()).toHaveLength(4);
    expect(arrange("grid")).toBe(true);
    expect(paneAgents()).toEqual([["a1", "a2", "a3", "a4"]]);
    expect(layout().root).toEqual(originalRoot);
    expect(getArrangeWorkspaceState(KEY).snapshot).toBeNull();
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBeNull();
  });

  it("keeps the ORIGINAL snapshot across consecutive different presets", () => {
    seedWorkspace(["a1", "a2", "a3", "a4"]);
    const originalRoot = layout().root;
    arrange("columns-2");
    const firstSnapshot = getArrangeWorkspaceState(KEY).snapshot;
    arrange("grid");
    arrange("columns-3");
    expect(getArrangeWorkspaceState(KEY).snapshot).toBe(firstSnapshot);
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBe("columns-3");
    expect(restoreWorkspaceArrangement(KEY)).toBe(true);
    expect(layout().root).toEqual(originalRoot);
  });

  it("uses the selection, puts unselected tabs at the end of the first pane, then clears it", () => {
    const tabs = seedWorkspace(["a1", "a2", "a3", "a4"]);
    const selection = useArrangeSelectionStore.getState();
    selection.toggleTab(KEY, tabs[2] ?? "");
    selection.toggleTab(KEY, tabs[0] ?? "");
    expect(arrange("columns-2")).toBe(true);
    expect(paneAgents()).toEqual([["a3", "a2", "a4"], ["a1"]]);
    expect(allMainAgents()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(getArrangeSelection(KEY)).toEqual({ tabIds: [], agentIds: [] });
  });

  it("opens selected agents that are not open yet", () => {
    const tabs = seedWorkspace(["a1", "a2"]);
    const selection = useArrangeSelectionStore.getState();
    selection.toggleTab(KEY, tabs[0] ?? "");
    selection.toggleAgent(KEY, "a9");
    expect(arrange("columns-2")).toBe(true);
    expect(paneAgents()).toEqual([["a1", "a2"], ["a9"]]);
  });

  it("falls back to every session when the selection no longer matches any open tab", () => {
    seedWorkspace(["a1", "a2"]);
    useArrangeSelectionStore.getState().toggleTab(KEY, "tab-that-was-closed");
    expect(arrange("columns-2")).toBe(true);
    expect(paneAgents()).toEqual([["a1"], ["a2"]]);
  });

  it("leaves the Explorer visible, in place and untouched", () => {
    seedWorkspace(["a1", "a2", "a3"]);
    useWorkspaceLayoutStore.getState().showExplorerSidebar(KEY);
    const before = findPaneById(layout().root, "explorer");
    expect(before?.hidden).not.toBe(true);
    arrange("grid");
    expect(findPaneById(layout().root, "explorer")).toEqual(before);
    restoreWorkspaceArrangement(KEY);
    expect(findPaneById(layout().root, "explorer")).toEqual(before);
  });

  it("keeps a hidden Explorer hidden", () => {
    seedWorkspace(["a1", "a2"]);
    expect(findPaneById(layout().root, "explorer")?.hidden).toBe(true);
    arrange("columns-2");
    expect(findPaneById(layout().root, "explorer")?.hidden).toBe(true);
    // and the user's later choice survives a restore
    useWorkspaceLayoutStore.getState().showExplorerSidebar(KEY);
    restoreWorkspaceArrangement(KEY);
    expect(findPaneById(layout().root, "explorer")?.hidden).not.toBe(true);
  });

  it("focuses the first pane and drops dragged split sizes", () => {
    seedWorkspace(["a1", "a2", "a3"]);
    useWorkspaceLayoutStore.getState().resizeSplit(KEY, "workspace-root", [0.5, 0.5]);
    arrange("columns-3");
    expect(layout().focusedPaneId).toBe(mainPanes()[0]?.id);
    expect(useWorkspaceLayoutStore.getState().splitSizesByWorkspace[KEY]).toEqual({});
  });
});

describe("restoreWorkspaceArrangement", () => {
  it("returns false when there is nothing to restore", () => {
    seedWorkspace(["a1"]);
    expect(restoreWorkspaceArrangement(KEY)).toBe(false);
  });

  it("brings split-size overrides back with the layout", () => {
    seedWorkspace(["a1", "a2"]);
    const rootId = (layout().root as { group: { id: string } }).group.id;
    useWorkspaceLayoutStore.getState().resizeSplit(KEY, rootId, [0.6, 0.4]);
    arrange("columns-2");
    expect(useWorkspaceLayoutStore.getState().splitSizesByWorkspace[KEY]).toEqual({});
    restoreWorkspaceArrangement(KEY);
    expect(useWorkspaceLayoutStore.getState().splitSizesByWorkspace[KEY]?.[rootId]).toEqual([
      0.6, 0.4,
    ]);
  });

  it("reconciles: drops closed tabs, appends tabs opened since", () => {
    const tabs = seedWorkspace(["a1", "a2", "a3"]);
    arrange("columns-3");
    useWorkspaceLayoutStore.getState().closeTab(KEY, tabs[1] ?? "");
    openAgent("a4");
    expect(restoreWorkspaceArrangement(KEY)).toBe(true);
    expect(paneAgents()).toEqual([["a1", "a3", "a4"]]);
  });

  it("clears watch mode and the restore state but keeps named layouts", () => {
    seedWorkspace(["a1", "a2"]);
    saveNamedLayout(KEY, "Keep me");
    arrange("columns-2");
    restoreWorkspaceArrangement(KEY);
    const state = getArrangeWorkspaceState(KEY);
    expect(state).toMatchObject({ snapshot: null, lastPreset: null, watchActive: false });
    expect(state.namedLayouts).toHaveLength(1);
  });
});

describe("equalizeWorkspacePanes", () => {
  it("evens out the sizes and clears dragged overrides", () => {
    seedWorkspace(["a1", "a2", "a3"]);
    arrange("columns-3");
    const rootGroup = layout().root as { group: { children: Array<{ group?: { id: string } }> } };
    const row = rootGroup.group.children.find((child) => child.group)?.group;
    expect(row).toBeDefined();
    useWorkspaceLayoutStore.getState().resizeSplit(KEY, row?.id ?? "", [0.6, 0.2, 0.2]);
    expect(equalizeWorkspacePanes(KEY)).toBe(true);
    expect(useWorkspaceLayoutStore.getState().splitSizesByWorkspace[KEY]).toEqual({});
    const rowAfter = (
      layout().root as { group: { children: Array<{ group?: { sizes: number[] } }> } }
    ).group.children.find((child) => child.group)?.group;
    for (const size of rowAfter?.sizes ?? []) {
      expect(size).toBeCloseTo(1 / 3);
    }
  });

  it("does not disturb the restore point", () => {
    seedWorkspace(["a1", "a2"]);
    arrange("columns-2");
    equalizeWorkspacePanes(KEY);
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBe("columns-2");
    expect(getArrangeWorkspaceState(KEY).snapshot).not.toBeNull();
  });
});

describe("watch mode", () => {
  it("is a no-op when no agent is running or needs attention", () => {
    seedWorkspace(["a1", "a2"]);
    setAgents({ a1: "idle", a2: "idle" });
    const before = layout();
    expect(toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(false);
    expect(layout()).toBe(before);
    expect(getArrangeWorkspaceState(KEY).watchActive).toBe(false);
    expect(getArrangeWorkspaceState(KEY).snapshot).toBeNull();
  });

  it("grids the working agents, opening a running one that has no tab", () => {
    seedWorkspace(["a1", "a2", "a3"]);
    setAgents({ a1: "running", a2: "idle", a3: "attention", a4: "running", a5: "attention" });
    expect(toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(true);
    // a2 is idle (rides along at the end of the first pane); a5 needs attention but was never open.
    expect(paneAgents()).toEqual([["a1", "a2"], ["a3"], ["a4"]]);
    expect(getArrangeWorkspaceState(KEY)).toMatchObject({
      watchActive: true,
      lastPreset: "watch",
      watchedAgentIds: ["a1", "a3", "a4"],
    });
    expect(getArrangeWorkspaceState(KEY).snapshot).not.toBeNull();
  });

  it("ignores agents of other workspaces, archived ones and subagents", () => {
    seedWorkspace(["a1"]);
    setAgents({ a1: "idle" });
    const agents = new Map<string, Agent>([
      ["a1", agent("a1", "idle")],
      ["elsewhere", agent("elsewhere", "running", "ws-other")],
      ["archived", { ...agent("archived", "running"), archivedAt: new Date() } as Agent],
      ["child", { ...agent("child", "running"), parentAgentId: "a1" } as Agent],
    ]);
    useSessionStore.setState({ sessions: { [SERVER_ID]: { agents } } } as never);
    expect(toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(false);
  });

  it("pressing Watch again restores, and Watch twice does not touch the first snapshot", () => {
    seedWorkspace(["a1", "a2"]);
    const originalRoot = layout().root;
    setAgents({ a1: "running", a2: "running" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
    const { snapshot } = getArrangeWorkspaceState(KEY);
    expect(toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(true);
    expect(layout().root).toEqual(originalRoot);
    expect(getArrangeWorkspaceState(KEY)).toMatchObject({ watchActive: false, snapshot: null });
    expect(snapshot).not.toBeNull();
  });

  it("an explicit arrange while watching turns watch off but keeps the original restore point", () => {
    seedWorkspace(["a1", "a2"]);
    setAgents({ a1: "running", a2: "running" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
    const { snapshot } = getArrangeWorkspaceState(KEY);
    arrange("columns-2");
    expect(getArrangeWorkspaceState(KEY)).toMatchObject({
      watchActive: false,
      watchedAgentIds: [],
      lastPreset: "columns-2",
    });
    expect(getArrangeWorkspaceState(KEY).snapshot).toBe(snapshot);
  });
});

describe("extendWatchGrid", () => {
  it("adds an agent that started working, keeps finished ones, and leaves the snapshot alone", () => {
    seedWorkspace(["a1", "a2", "a3"]);
    setAgents({ a1: "running", a2: "idle", a3: "idle" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
    const { snapshot } = getArrangeWorkspaceState(KEY);

    // a1 finishes, a3 starts.
    setAgents({ a1: "idle", a2: "idle", a3: "running" });
    expect(extendWatchGrid({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(true);
    expect(getArrangeWorkspaceState(KEY).watchedAgentIds).toEqual(["a1", "a3"]);
    expect(paneAgents()).toEqual([["a1", "a2"], ["a3"]]);
    expect(getArrangeWorkspaceState(KEY).snapshot).toBe(snapshot);
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBe("watch");
  });

  it("opens a tab for a newly running agent and appends it after the watched ones", () => {
    seedWorkspace(["a1"]);
    setAgents({ a1: "running" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
    setAgents({ a1: "running", a7: "running" });
    expect(extendWatchGrid({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(true);
    expect(paneAgents()).toEqual([["a1"], ["a7"]]);
  });

  it("never re-arranges when nothing new joined, or when watch is off", () => {
    seedWorkspace(["a1", "a2"]);
    expect(extendWatchGrid({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(false);
    setAgents({ a1: "running", a2: "idle" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
    const before = layout();
    expect(extendWatchGrid({ workspaceKey: KEY, viewport: VIEWPORT })).toBe(false);
    expect(layout()).toBe(before);
  });
});

describe("named layouts", () => {
  it("saves, applies with a restore point, and deletes", () => {
    seedWorkspace(["a1", "a2", "a3", "a4"]);
    arrange("columns-2");
    const id = saveNamedLayout(KEY, "  Two columns ");
    expect(id).toBeTruthy();
    expect(getArrangeWorkspaceState(KEY).namedLayouts[0]?.name).toBe("Two columns");

    restoreWorkspaceArrangement(KEY);
    expect(paneAgents()).toEqual([["a1", "a2", "a3", "a4"]]);

    expect(applyNamedLayout(KEY, id ?? "")).toBe(true);
    expect(paneAgents()).toEqual([
      ["a1", "a2"],
      ["a3", "a4"],
    ]);
    // Applying snapshots first, so Restore goes back to the single pane.
    expect(getArrangeWorkspaceState(KEY).snapshot).not.toBeNull();
    expect(restoreWorkspaceArrangement(KEY)).toBe(true);
    expect(paneAgents()).toEqual([["a1", "a2", "a3", "a4"]]);

    deleteNamedLayout(KEY, id ?? "");
    expect(getArrangeWorkspaceState(KEY).namedLayouts).toEqual([]);
  });

  it("reconciles a saved layout against today's tabs", () => {
    const tabs = seedWorkspace(["a1", "a2", "a3", "a4"]);
    arrange("columns-2");
    const id = saveNamedLayout(KEY, "Pairs") ?? "";
    restoreWorkspaceArrangement(KEY);
    useWorkspaceLayoutStore.getState().closeTab(KEY, tabs[0] ?? "");
    openAgent("a5");
    applyNamedLayout(KEY, id);
    expect(paneAgents()).toEqual([
      ["a2", "a5"],
      ["a3", "a4"],
    ]);
  });

  it("keeps the restore point of a run when a named layout is applied mid-run", () => {
    seedWorkspace(["a1", "a2"]);
    const id = saveNamedLayout(KEY, "Cols") ?? "";
    arrange("columns-2");
    const { snapshot } = getArrangeWorkspaceState(KEY);
    applyNamedLayout(KEY, id);
    expect(getArrangeWorkspaceState(KEY).snapshot).toBe(snapshot);
  });

  it("saving under an existing name (any case) updates that layout", () => {
    seedWorkspace(["a1", "a2"]);
    const first = saveNamedLayout(KEY, "Review");
    arrange("columns-2");
    const second = saveNamedLayout(KEY, "review");
    expect(second).toBe(first);
    expect(getArrangeWorkspaceState(KEY).namedLayouts).toHaveLength(1);
  });

  it("rejects a blank name and an unknown id", () => {
    seedWorkspace(["a1"]);
    expect(saveNamedLayout(KEY, "   ")).toBeNull();
    expect(applyNamedLayout(KEY, "missing")).toBe(false);
  });
});

describe("hooks", () => {
  it("reflect the arrange state and keep named-layout results stable", () => {
    seedWorkspace(["a1", "a2"]);
    const canRestore = renderHook(() => useCanRestoreArrangement(KEY));
    const watching = renderHook(() => useWatchModeActive(KEY));
    const named = renderHook(() => useNamedLayouts(KEY));
    const none = renderHook(() => useNamedLayouts(null));
    expect(canRestore.result.current).toBe(false);
    expect(watching.result.current).toBe(false);
    expect(named.result.current).toEqual([]);
    expect(none.result.current).toEqual([]);

    act(() => {
      arrange("columns-2");
      saveNamedLayout(KEY, "Cols");
    });
    expect(canRestore.result.current).toBe(true);
    expect(named.result.current.map((entry) => entry.name)).toEqual(["Cols"]);
    const stable = named.result.current;
    named.rerender();
    expect(named.result.current).toBe(stable);
    expect(Object.keys(named.result.current[0] ?? {}).sort()).toEqual(["id", "name", "savedAt"]);

    act(() => {
      restoreWorkspaceArrangement(KEY);
    });
    expect(canRestore.result.current).toBe(false);
  });
});

describe("useLiveWatch", () => {
  function startWatching(): void {
    seedWorkspace(["a1"]);
    setAgents({ a1: "running" });
    toggleWatchMode({ workspaceKey: KEY, viewport: VIEWPORT });
  }

  it("re-arranges once after the debounce when an agent joins", () => {
    vi.useFakeTimers();
    startWatching();
    renderHook(() => useLiveWatch(KEY, VIEWPORT));
    expect(paneAgents()).toEqual([["a1"]]);

    act(() => {
      setAgents({ a1: "running", a2: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(paneAgents()).toEqual([["a1"]]);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(paneAgents()).toEqual([["a1"], ["a2"]]);
  });

  it("coalesces a burst of agents into a single re-arrange", () => {
    vi.useFakeTimers();
    startWatching();
    const applySpy = vi.spyOn(useWorkspaceLayoutStore.getState(), "applyArrangedLayout");
    renderHook(() => useLiveWatch(KEY, VIEWPORT));

    act(() => {
      setAgents({ a1: "running", a2: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      setAgents({ a1: "running", a2: "running", a3: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(paneAgents()).toEqual([["a1"]]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(paneAgents()).toEqual([["a1"], ["a2"], ["a3"]]);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing while watch is off, without a viewport, or when nothing new joined", () => {
    vi.useFakeTimers();
    seedWorkspace(["a1"]);
    setAgents({ a1: "running" });
    const watchOff = renderHook(() => useLiveWatch(KEY, VIEWPORT));
    act(() => {
      setAgents({ a1: "running", a2: "running" });
      vi.advanceTimersByTime(1000);
    });
    expect(paneAgents()).toEqual([["a1"]]);
    watchOff.unmount();

    startWatching();
    const idle = renderHook(() => useLiveWatch(KEY, null));
    act(() => {
      setAgents({ a1: "running", a2: "running" });
      vi.advanceTimersByTime(1000);
    });
    expect(paneAgents()).toEqual([["a1"]]);
    idle.unmount();

    const before = layout();
    renderHook(() => useLiveWatch(KEY, VIEWPORT));
    act(() => {
      setAgents({ a1: "idle" });
      vi.advanceTimersByTime(1000);
    });
    expect(layout()).toBe(before);
  });

  it("cancels a pending re-arrange on unmount", () => {
    vi.useFakeTimers();
    startWatching();
    const view = renderHook(() => useLiveWatch(KEY, VIEWPORT));
    act(() => {
      setAgents({ a1: "running", a2: "running" });
    });
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(paneAgents()).toEqual([["a1"]]);
  });
});

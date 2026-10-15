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

import { useBoardStore } from "@/boards/board-store";
import {
  addWorkspacesToBoard,
  getBoard,
  openDraftInPane,
  removeBoardTab,
  removeWorkspaceFromBoard,
  renameBoard,
  retargetBoardTab,
  splitWorkspaces,
} from "@/boards/controller";
import { resetSplitSyncForTests, syncSplitBoards, useSplitBoardSync } from "@/boards/split-sync";
import type { Board } from "@/boards/types";
import { LIVE_BOARD_ID } from "@/boards/types";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  collectAllPanes,
  collectAllTabs,
  createWorkspaceLayoutWithExplorerSidebar,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { reconcileWorkspaceTabs } from "@/stores/workspace-layout-actions";
import {
  buildWorkspaceTabSnapshot,
  deriveWorkspaceAgentVisibility,
} from "@/workspace-tabs/agent-visibility";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const VIEWPORT = { width: 1800, height: 1100 };
const W = (workspaceId: string, serverId = "s1") => ({ serverId, workspaceId });

function makeAgent(id: string, workspaceId: string, archived = false): Agent {
  return {
    id,
    serverId: "s1",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    pendingPermissions: [],
    requiresAttention: false,
    attentionReason: null,
    archivedAt: archived ? new Date() : null,
    parentAgentId: null,
    workspaceId,
    createdAt: new Date(1000),
  } as unknown as Agent;
}

/** The host's agent list: id -> workspace (archived ones as "id!"). */
function setAgents(byWorkspace: Record<string, string[]>): void {
  const agents = new Map<string, Agent>();
  for (const [workspaceId, ids] of Object.entries(byWorkspace)) {
    for (const id of ids) {
      agents.set(id, makeAgent(id, workspaceId));
    }
  }
  useSessionStore.setState({
    sessions: {
      s1: { agents, agentDetails: new Map(), workspaces: new Map(), hasHydratedAgents: true },
    },
  } as never);
}

function wsKey(workspaceId: string): string {
  return buildWorkspaceTabPersistenceKey({ serverId: "s1", workspaceId })!;
}

function openWorkspaceAgents(workspaceId: string, agentIds: string[]): void {
  useWorkspaceLayoutStore.setState((state) => ({
    layoutByWorkspace: {
      ...state.layoutByWorkspace,
      [wsKey(workspaceId)]: createWorkspaceLayoutWithExplorerSidebar(),
    },
  }));
  for (const agentId of agentIds) {
    openWorkspaceAgent(workspaceId, agentId);
  }
}

function openWorkspaceAgent(workspaceId: string, agentId: string): void {
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: wsKey(workspaceId),
    target: { kind: "agent", agentId },
    intent: "background",
  });
}

function workspaceAgents(workspaceId: string): string[] {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[wsKey(workspaceId)];
  return layout
    ? collectAllTabs(layout.root).flatMap((tab) =>
        tab.target.kind === "agent" ? [tab.target.agentId] : [],
      )
    : [];
}

function mustBoard(boardId: string | null): Board {
  const board = boardId ? getBoard(boardId) : null;
  if (!board) {
    throw new Error("no board");
  }
  return board;
}

function paneAgents(board: Board): string[][] {
  return collectAllPanes(board.layout.root).map((pane) =>
    pane.tabIds.map((tabId) => board.origins[tabId]?.agentId ?? "?"),
  );
}

function activeAgents(board: Board): Array<string | null> {
  return collectAllPanes(board.layout.root).map(
    (pane) => (pane.focusedTabId ? board.origins[pane.focusedTabId]?.agentId : null) ?? null,
  );
}

function tabIdOf(board: Board, agentId: string): string {
  const found = Object.entries(board.origins).find(([, origin]) => origin.agentId === agentId);
  if (!found) {
    throw new Error(`no tab for ${agentId}`);
  }
  return found[0];
}

/** Two workspaces, w1 (a1) and w2 (b1), already open in a view. */
function openView(): string {
  setAgents({ w1: ["a1"], w2: ["b1"] });
  openWorkspaceAgents("w1", ["a1"]);
  openWorkspaceAgents("w2", ["b1"]);
  const id = splitWorkspaces({
    workspaces: [W("w1"), W("w2")],
    layout: "columns",
    viewport: VIEWPORT,
  })!;
  return id;
}

beforeEach(() => {
  resetSplitSyncForTests();
  useBoardStore.setState({ boards: {}, order: [], arrangeByBoard: {}, splitPairs: {} });
  useBoardStore.getState().ensureLive();
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    splitSizesByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    pinnedAgentIdsByWorkspace: {},
    hiddenAgentIdsByWorkspace: {},
  });
  setAgents({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("B2: a split view follows its workspaces", () => {
  it("a session the workspace gains joins its pane and becomes the active tab, without a reopen", () => {
    const id = openView();
    const before = mustBoard(id);
    const a1Tab = tabIdOf(before, "a1");
    const b1Tab = tabIdOf(before, "b1");

    setAgents({ w1: ["a1", "a2"], w2: ["b1"] });
    openWorkspaceAgent("w1", "a2");
    syncSplitBoards();

    const after = mustBoard(id);
    expect(paneAgents(after)).toEqual([["a1", "a2"], ["b1"]]);
    expect(activeAgents(after)).toEqual(["a2", "b1"]);
    // Existing tabs keep their ids, so open panels do not remount.
    expect(after.origins[a1Tab]?.agentId).toBe("a1");
    expect(after.origins[b1Tab]?.agentId).toBe("b1");
    // The board's own focus does not jump to the pane that grew.
    expect(after.layout.focusedPaneId).toBe(before.layout.focusedPaneId);
  });

  it("an agent created while the workspace is not on screen joins too", () => {
    const id = openView();
    // Nobody reconciled w2's layout: only the agent list knows about b2.
    setAgents({ w1: ["a1"], w2: ["b1", "b2"] });
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1", "b2"]]);
    expect(activeAgents(mustBoard(id))).toEqual(["a1", "b2"]);
  });

  it("does nothing on the first pass: the baseline is taken, not a flood of everything", () => {
    setAgents({ w1: ["a1", "a2"], w2: ["b1"] });
    openWorkspaceAgents("w1", ["a1"]);
    openWorkspaceAgents("w2", ["b1"]);
    const id = splitWorkspaces({
      workspaces: [W("w1"), W("w2")],
      layout: "columns",
      viewport: VIEWPORT,
    })!;
    resetSplitSyncForTests();
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
  });

  it("waits while the agent list is not loaded instead of treating it as everything closed", () => {
    const id = openView();
    useSessionStore.setState({
      sessions: { s1: { agents: new Map(), agentDetails: new Map(), hasHydratedAgents: false } },
    } as never);
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
  });

  it("a tab closed in the workspace disappears from the view", () => {
    const id = openView();
    setAgents({ w1: ["a1", "a2"], w2: ["b1"] });
    openWorkspaceAgent("w1", "a2");
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))[0]).toEqual(["a1", "a2"]);

    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[wsKey("w1")]!;
    const a2 = collectAllTabs(layout.root).find(
      (tab) => tab.target.kind === "agent" && tab.target.agentId === "a2",
    )!;
    useWorkspaceLayoutStore.getState().hideAgent(wsKey("w1"), "a2");
    useWorkspaceLayoutStore.getState().closeTab(wsKey("w1"), a2.tabId);
    syncSplitBoards();

    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
  });

  it("an agent archived elsewhere leaves the view", () => {
    const id = openView();
    setAgents({ w1: [], w2: ["b1"] });
    syncSplitBoards();
    // Its pane held only a1, so the pane goes with it, and the view's set follows.
    expect(paneAgents(mustBoard(id))).toEqual([["b1"]]);
  });

  it("a tab closed in the view closes in the workspace too, and stays closed", () => {
    const id = openView();
    setAgents({ w1: ["a1", "a2"], w2: ["b1"] });
    openWorkspaceAgent("w1", "a2");
    syncSplitBoards();
    const a2Tab = tabIdOf(mustBoard(id), "a2");

    removeBoardTab(id, a2Tab);

    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
    expect(workspaceAgents("w1")).toEqual(["a1"]);
    // Hidden, so the workspace does not auto-open it again; the next pass must not bring it back.
    expect(
      useWorkspaceLayoutStore.getState().hiddenAgentIdsByWorkspace[wsKey("w1")]?.has("a2"),
    ).toBe(true);
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
  });

  it("closing a tab on the Live view stays on the Live view", () => {
    setAgents({ w1: ["a1"] });
    openWorkspaceAgents("w1", ["a1"]);
    useBoardStore.getState().ensureLive();
    const live = mustBoard(LIVE_BOARD_ID);
    removeBoardTab(LIVE_BOARD_ID, "nothing");
    expect(mustBoard(LIVE_BOARD_ID)).toBe(live);
    expect(workspaceAgents("w1")).toEqual(["a1"]);
  });

  it("a draft the user is typing in survives a pass", () => {
    const id = openView();
    const paneId = collectAllPanes(mustBoard(id).layout.root)[0]!.id;
    const draftTab = openDraftInPane(id, paneId)!;
    setAgents({ w1: ["a1"], w2: ["b1", "b2"] });
    syncSplitBoards();
    expect(mustBoard(id).origins[draftTab]).toBeDefined();
  });

  it("a session started inside the view reaches the full workspace, and the view does not double it", () => {
    const id = openView();
    const paneId = collectAllPanes(mustBoard(id).layout.root)[0]!.id;
    const draftTab = openDraftInPane(id, paneId)!;

    // The agent is created in w1; the draft tab becomes it.
    setAgents({ w1: ["a1", "a9"], w2: ["b1"] });
    retargetBoardTab(id, draftTab, { kind: "agent", agentId: "a9" });
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))[0]).toEqual(["a1", "a9"]);

    // The full workspace opens: its own reconcile auto-opens the agent, because the view never
    // hid it.
    const key1 = wsKey("w1");
    const state = useWorkspaceLayoutStore.getState();
    const session = useSessionStore.getState().sessions.s1!;
    const reconciled = reconcileWorkspaceTabs(
      {
        layout: state.layoutByWorkspace[key1]!,
        pinnedAgentIds: null,
        hiddenAgentIds: state.hiddenAgentIdsByWorkspace[key1] ?? null,
        explorerSidebarPaneId: null,
      },
      buildWorkspaceTabSnapshot({
        agentVisibility: deriveWorkspaceAgentVisibility({
          sessionAgents: session.agents,
          agentDetails: session.agentDetails,
          workspaceId: "w1",
        }),
        agentsHydrated: true,
        terminalsHydrated: false,
        knownTerminalIds: [],
        standaloneTerminalIds: [],
        hasActivePendingTerminalCreate: false,
        hasActivePendingDraftCreate: false,
      }),
    );
    const opened = collectAllTabs(reconciled.layout.root).flatMap((tab) =>
      tab.target.kind === "agent" ? [tab.target.agentId] : [],
    );
    expect(opened).toContain("a9");
  });

  it("if the workspace announces the new agent before the draft is retargeted, the draft keeps the slot", () => {
    const id = openView();
    const paneId = collectAllPanes(mustBoard(id).layout.root)[0]!.id;
    const draftTab = openDraftInPane(id, paneId)!;

    setAgents({ w1: ["a1", "a9"], w2: ["b1"] });
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))[0]).toEqual(["a1", "?", "a9"]);

    retargetBoardTab(id, draftTab, { kind: "agent", agentId: "a9" });
    const after = mustBoard(id);
    expect(paneAgents(after)[0]).toEqual(["a1", "a9"]);
    expect(after.origins[draftTab]?.agentId).toBe("a9");
    expect(activeAgents(after)[0]).toBe("a9");
  });

  it("useSplitBoardSync runs a pass shortly after a workspace gains a tab", () => {
    vi.useFakeTimers();
    const id = openView();
    renderHook(() => useSplitBoardSync());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      setAgents({ w1: ["a1", "a2"], w2: ["b1"] });
      openWorkspaceAgent("w1", "a2");
    });
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"]]);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(paneAgents(mustBoard(id))).toEqual([["a1", "a2"], ["b1"]]);
  });

  it("a workspace added to the view later is followed from the moment it joins", () => {
    const id = openView();
    setAgents({ w1: ["a1"], w2: ["b1"], w3: ["c1"] });
    openWorkspaceAgents("w3", ["c1"]);
    addWorkspacesToBoard(id, [W("w3")], VIEWPORT);
    setAgents({ w1: ["a1"], w2: ["b1"], w3: ["c1", "c2"] });
    syncSplitBoards();
    expect(paneAgents(mustBoard(id))).toEqual([["a1"], ["b1"], ["c1", "c2"]]);
  });
});

describe("B3: a renamed view keeps its name", () => {
  it("survives adding and removing a workspace and reopening the same set", () => {
    const id = openView();
    renameBoard(id, "Backlog");
    expect(mustBoard(id).name).toBe("Backlog");

    setAgents({ w1: ["a1"], w2: ["b1"], w3: ["c1"] });
    openWorkspaceAgents("w3", ["c1"]);
    addWorkspacesToBoard(id, [W("w3")], VIEWPORT);
    expect(mustBoard(id).name).toBe("Backlog");

    // Reopening the NEW set finds the same view and keeps the name.
    const reopened = splitWorkspaces({
      workspaces: [W("w1"), W("w2"), W("w3")],
      layout: "columns",
      viewport: VIEWPORT,
    });
    expect(reopened).toBe(id);
    expect(mustBoard(id).name).toBe("Backlog");

    const w3Pane = collectAllPanes(mustBoard(id).layout.root)[2]!;
    expect(removeWorkspaceFromBoard(id, w3Pane.id)).toBe(true);
    expect(mustBoard(id).name).toBe("Backlog");
    expect(
      splitWorkspaces({ workspaces: [W("w1"), W("w2")], layout: "columns", viewport: VIEWPORT }),
    ).toBe(id);
    expect(mustBoard(id).name).toBe("Backlog");
  });

  it("is not reverted by a pane emptied through sync", () => {
    const id = openView();
    renameBoard(id, "Backlog");
    setAgents({ w1: [], w2: ["b1"] });
    syncSplitBoards();
    expect(mustBoard(id).name).toBe("Backlog");
  });
});

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

import { getBoardArrangeState, useBoardStore } from "@/boards/board-store";
import {
  addSessionsToBoard,
  arrangeBoard,
  createBoard,
  deleteBoard,
  equalizeBoardPanes,
  focusBoardPane,
  getBoard,
  moveBoardTabToPane,
  refreshLiveBoard,
  removeBoardTab,
  renameBoard,
  resizeBoardSplit,
  restoreBoardArrangement,
  selectBoardTab,
  splitWorkspaces,
  useBoard,
  useBoards,
  useLiveBoardSync,
} from "@/boards/controller";
import { listBoardTabs } from "@/boards/model";
import { LIVE_BOARD_ID, type Board, type BoardSessionRef } from "@/boards/types";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  collectAllPanes,
  collectAllTabs,
  createWorkspaceLayoutWithExplorerSidebar,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const VIEWPORT = { width: 1800, height: 1100 };

type AgentState = "idle" | "running" | "attention";

interface AgentSpec {
  state?: AgentState;
  workspaceId?: string;
  serverId?: string;
  archived?: boolean;
  parent?: string;
  createdAt?: number;
}

function makeAgent(id: string, spec: AgentSpec): Agent {
  const state = spec.state ?? "idle";
  return {
    id,
    serverId: spec.serverId ?? "s1",
    status: state === "running" ? "running" : "idle",
    turn:
      state === "running"
        ? { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null }
        : { phase: "idle", cancellationRequestId: null },
    pendingPermissions: [],
    requiresAttention: state === "attention",
    attentionReason: state === "attention" ? "finished" : null,
    archivedAt: spec.archived ? new Date() : null,
    parentAgentId: spec.parent ?? null,
    workspaceId: spec.workspaceId ?? "w1",
    createdAt: new Date(spec.createdAt ?? 1000),
  } as unknown as Agent;
}

/** Replaces every host's agents (and optionally workspace names). */
function setWorld(
  agentsByServer: Record<string, Record<string, AgentSpec>>,
  workspaceNames: Record<string, Record<string, string>> = {},
): void {
  const sessions: Record<string, unknown> = {};
  const servers = new Set([...Object.keys(agentsByServer), ...Object.keys(workspaceNames)]);
  for (const serverId of servers) {
    const agents = new Map(
      Object.entries(agentsByServer[serverId] ?? {}).map(([id, spec]) => [
        id,
        makeAgent(id, { ...spec, serverId }),
      ]),
    );
    const workspaces = new Map(
      Object.entries(workspaceNames[serverId] ?? {}).map(([id, name]) => [id, { id, name }]),
    );
    sessions[serverId] = { agents, workspaces };
  }
  useSessionStore.setState({ sessions } as never);
}

function ref(agentId: string, serverId = "s1", workspaceId = "w1"): BoardSessionRef {
  return { serverId, workspaceId, agentId };
}

function wsKey(serverId: string, workspaceId: string): string {
  return buildWorkspaceTabPersistenceKey({ serverId, workspaceId })!;
}

/** Gives a workspace a layout with the given agent tabs open; the last opened is focused. */
function openWorkspaceAgents(serverId: string, workspaceId: string, agentIds: string[]): void {
  const key = wsKey(serverId, workspaceId);
  useWorkspaceLayoutStore.setState((state) => ({
    layoutByWorkspace: {
      ...state.layoutByWorkspace,
      [key]: createWorkspaceLayoutWithExplorerSidebar(),
    },
  }));
  for (const agentId of agentIds) {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: key,
      target: { kind: "agent", agentId },
      intent: "background",
    });
  }
}

function focusWorkspaceAgent(serverId: string, workspaceId: string, agentId: string): void {
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: wsKey(serverId, workspaceId),
    target: { kind: "agent", agentId },
    intent: "reveal",
  });
}

function openWorkspaceFile(
  serverId: string,
  workspaceId: string,
  path: string,
  intent: "background" | "reveal" = "background",
): void {
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: wsKey(serverId, workspaceId),
    target: { kind: "file", path },
    intent,
  });
}

function mustBoard(boardId: string | null): Board {
  const board = boardId ? getBoard(boardId) : null;
  if (!board) {
    throw new Error("no board");
  }
  return board;
}

function agentOf(board: Board, tabId: string | null | undefined): string | null {
  const origin = tabId ? board.origins[tabId] : undefined;
  return origin?.agentId ?? null;
}

/** "a1" for an agent tab, "file:<path>" for a file tab; "?" for anything else. */
function entryOf(board: Board, tabId: string | null | undefined): string | null {
  const origin = tabId ? board.origins[tabId] : undefined;
  if (!origin) {
    return null;
  }
  return origin.agentId ?? (origin.path ? `file:${origin.path}` : "?");
}

function paneEntries(board: Board): string[][] {
  return collectAllPanes(board.layout.root).map((pane) =>
    pane.tabIds.map((tabId) => entryOf(board, tabId) ?? "?"),
  );
}

/** Agent ids per pane in tree order. */
function paneAgents(board: Board): string[][] {
  return collectAllPanes(board.layout.root).map((pane) =>
    pane.tabIds.map((tabId) => agentOf(board, tabId) ?? "?"),
  );
}

function shownAgents(board: Board): Array<string | null> {
  return collectAllPanes(board.layout.root).map((pane) => agentOf(board, pane.focusedTabId));
}

function rowShape(board: Board): number[] {
  const root = board.layout.root;
  if (root.kind === "pane") {
    return [1];
  }
  if (root.group.direction === "horizontal") {
    return [root.group.children.length];
  }
  return root.group.children.map((row) => (row.kind === "group" ? row.group.children.length : 1));
}

function agentsOnBoard(board: Board): string[] {
  return listBoardTabs(board.layout).map((tab) =>
    tab.target.kind === "agent" ? tab.target.agentId : "?",
  );
}

beforeEach(() => {
  useBoardStore.setState({
    boards: {},
    order: [],
    arrangeByBoard: {},
    splitPairs: {},
  });
  useBoardStore.getState().ensureLive();
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    splitSizesByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    pinnedAgentIdsByWorkspace: {},
    hiddenAgentIdsByWorkspace: {},
  });
  setWorld({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("board basics", () => {
  it("creates a board with trimmed name and sessions", () => {
    const id = createBoard("  Review  ", [ref("a"), ref("b")]);
    const board = mustBoard(id);
    expect(board.name).toBe("Review");
    expect(board.kind).toBe("user");
    expect(agentsOnBoard(board)).toEqual(["a", "b"]);
    expect(useBoardStore.getState().order).toEqual([LIVE_BOARD_ID, id]);
  });

  it("defaults the name to Board N, skipping taken ones", () => {
    const first = mustBoard(createBoard("   "));
    const second = mustBoard(createBoard(""));
    expect(first.name).toBe("Board 1");
    expect(second.name).toBe("Board 2");
    renameBoard(second.id, "Board 3");
    expect(mustBoard(createBoard("")).name).toBe("Board 4");
  });

  it("renames, but never to nothing and never the Live board", () => {
    const id = createBoard("One")!;
    renameBoard(id, "  Two ");
    expect(mustBoard(id).name).toBe("Two");
    renameBoard(id, "   ");
    expect(mustBoard(id).name).toBe("Two");
    renameBoard(LIVE_BOARD_ID, "Hijacked");
    expect(mustBoard(LIVE_BOARD_ID).name).toBe("Live");
  });

  it("deletes a board but never the Live board", () => {
    const id = createBoard("One")!;
    deleteBoard(id);
    expect(getBoard(id)).toBeNull();
    deleteBoard(LIVE_BOARD_ID);
    expect(getBoard(LIVE_BOARD_ID)).not.toBeNull();
  });

  it("getBoard creates the Live board on first read if it is missing", () => {
    useBoardStore.setState({ boards: {}, order: [] });
    expect(getBoard(LIVE_BOARD_ID)?.kind).toBe("live");
    expect(getBoard("nope")).toBeNull();
  });

  it("adding sessions skips ones already there and reports how many were new", () => {
    const id = createBoard("One", [ref("a")])!;
    expect(addSessionsToBoard(id, [ref("a"), ref("b"), ref("c")])).toBe(2);
    expect(addSessionsToBoard(id, [ref("b")])).toBe(0);
    expect(agentsOnBoard(mustBoard(id))).toEqual(["a", "b", "c"]);
    expect(addSessionsToBoard("ghost", [ref("z")])).toBe(0);
  });

  it("the same agent id on another host is another session", () => {
    const id = createBoard("One", [ref("a", "s1"), ref("a", "s2")])!;
    expect(agentsOnBoard(mustBoard(id))).toEqual(["a", "a"]);
  });

  it("removing a tab drops its origin and collapses an emptied pane", () => {
    const id = splitWorkspacesFixture();
    const board = mustBoard(id);
    const [leftTab] = collectAllPanes(board.layout.root)[0]!.tabIds;
    removeBoardTab(id, leftTab!);
    const after = mustBoard(id);
    expect(after.origins[leftTab!]).toBeUndefined();
    expect(collectAllPanes(after.layout.root)).toHaveLength(1);
    removeBoardTab("ghost", "x");
  });

  it("removing the last tab keeps one empty pane", () => {
    const id = createBoard("One", [ref("a")])!;
    removeBoardTab(id, Object.keys(mustBoard(id).origins)[0]!);
    const board = mustBoard(id);
    expect(collectAllPanes(board.layout.root)).toHaveLength(1);
    expect(collectAllTabs(board.layout.root)).toHaveLength(0);
  });

  function splitWorkspacesFixture(): string {
    setWorld({ s1: { a: {}, b: {} } });
    openWorkspaceAgents("s1", "w1", ["a"]);
    openWorkspaceAgents("s1", "w2", ["b"]);
    return splitWorkspaces({
      workspaces: [
        { serverId: "s1", workspaceId: "w1" },
        { serverId: "s1", workspaceId: "w2" },
      ],
      layout: "columns",
      viewport: null,
    })!;
  }

  it("focus, select, move and resize edit the layout", () => {
    const id = createBoard("One", [ref("a"), ref("b"), ref("c")])!;
    arrangeBoard({ boardId: id, preset: "columns-2", viewport: VIEWPORT });
    let board = mustBoard(id);
    expect(paneAgents(board)).toEqual([["a", "b"], ["c"]]);
    const [left, right] = collectAllPanes(board.layout.root);

    focusBoardPane(id, right!.id);
    expect(mustBoard(id).layout.focusedPaneId).toBe(right!.id);

    selectBoardTab(id, left!.id, left!.tabIds[1]!);
    board = mustBoard(id);
    expect(agentOf(board, collectAllPanes(board.layout.root)[0]!.focusedTabId)).toBe("b");
    expect(board.layout.focusedPaneId).toBe(left!.id);

    moveBoardTabToPane(id, left!.tabIds[0]!, right!.id);
    expect(paneAgents(mustBoard(id))).toEqual([["b"], ["c", "a"]]);

    const root = mustBoard(id).layout.root;
    if (root.kind !== "group") {
      throw new Error("expected group");
    }
    resizeBoardSplit(id, root.group.id, [3, 1]);
    expect(mustBoard(id).splitSizes[root.group.id]).toEqual([0.75, 0.25]);
  });
});

describe("arrangeBoard", () => {
  function four(): string {
    return createBoard("Four", [ref("a"), ref("b"), ref("c"), ref("d")])!;
  }

  it("arranges every session into the preset", () => {
    const id = four();
    expect(arrangeBoard({ boardId: id, preset: "columns-2", viewport: VIEWPORT })).toBe(true);
    expect(paneAgents(mustBoard(id))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(getBoardArrangeState(id).lastPreset).toBe("columns-2");
  });

  it("pressing the same preset again toggles back to the original layout", () => {
    const id = four();
    const originalRoot = mustBoard(id).layout.root;
    expect(arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT })).toBe(true);
    expect(collectAllPanes(mustBoard(id).layout.root)).toHaveLength(4);
    expect(arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT })).toBe(true);
    expect(mustBoard(id).layout.root).toEqual(originalRoot);
    expect(getBoardArrangeState(id).snapshot).toBeNull();
    expect(getBoardArrangeState(id).lastPreset).toBeNull();
  });

  it("keeps the ORIGINAL snapshot across consecutive different presets", () => {
    const id = four();
    const originalRoot = mustBoard(id).layout.root;
    arrangeBoard({ boardId: id, preset: "columns-2", viewport: VIEWPORT });
    const firstSnapshot = getBoardArrangeState(id).snapshot;
    arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT });
    arrangeBoard({ boardId: id, preset: "columns-3", viewport: VIEWPORT });
    expect(getBoardArrangeState(id).snapshot).toBe(firstSnapshot);
    expect(getBoardArrangeState(id).lastPreset).toBe("columns-3");
    expect(restoreBoardArrangement(id)).toBe(true);
    expect(mustBoard(id).layout.root).toEqual(originalRoot);
  });

  it("restore reconciles with tabs closed and opened since", () => {
    const id = four();
    arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT });
    const board = mustBoard(id);
    const aTab = Object.entries(board.origins).find(([, o]) => o.agentId === "a")![0];
    removeBoardTab(id, aTab);
    addSessionsToBoard(id, [ref("e")]);
    expect(restoreBoardArrangement(id)).toBe(true);
    expect(paneAgents(mustBoard(id)).flat().sort()).toEqual(["b", "c", "d", "e"]);
    expect(restoreBoardArrangement(id)).toBe(false);
  });

  it("does nothing on an unknown or empty board", () => {
    expect(arrangeBoard({ boardId: "ghost", preset: "grid", viewport: VIEWPORT })).toBe(false);
    const empty = createBoard("Empty")!;
    expect(arrangeBoard({ boardId: empty, preset: "grid", viewport: VIEWPORT })).toBe(false);
    expect(getBoardArrangeState(empty).lastPreset).toBeNull();
    expect(restoreBoardArrangement("ghost")).toBe(false);
    expect(equalizeBoardPanes("ghost")).toBe(false);
  });

  it("equalize evens the splits and clears dragged sizes", () => {
    const id = four();
    arrangeBoard({ boardId: id, preset: "columns-2", viewport: VIEWPORT });
    const root = mustBoard(id).layout.root;
    if (root.kind !== "group") {
      throw new Error("expected group");
    }
    resizeBoardSplit(id, root.group.id, [3, 1]);
    expect(equalizeBoardPanes(id)).toBe(true);
    const after = mustBoard(id);
    expect(after.splitSizes).toEqual({});
    if (after.layout.root.kind !== "group") {
      throw new Error("expected group");
    }
    expect(after.layout.root.group.sizes).toEqual([0.5, 0.5]);
  });

  it("works on the Live board too", () => {
    addSessionsToBoard(LIVE_BOARD_ID, [ref("a"), ref("b")]);
    expect(arrangeBoard({ boardId: LIVE_BOARD_ID, preset: "columns-2", viewport: VIEWPORT })).toBe(
      true,
    );
    expect(paneAgents(mustBoard(LIVE_BOARD_ID))).toEqual([["a"], ["b"]]);
  });
});

const W = (workspaceId: string, serverId = "s1") => ({ serverId, workspaceId });

function split(
  workspaceIds: string[],
  layout: "columns" | "grid" = "columns",
  viewport: { width: number; height: number } | null = VIEWPORT,
): string | null {
  return splitWorkspaces({ workspaces: workspaceIds.map((id) => W(id)), layout, viewport });
}

describe("splitWorkspaces", () => {
  it("makes one pane per workspace holding its open agent tabs, in layout order", () => {
    setWorld({ s1: { a1: {}, a2: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a2"]);
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const board = mustBoard(split(["w1", "w2"]));
    expect(paneAgents(board)).toEqual([["a1", "a2"], ["b1"]]);
    expect(board.kind).toBe("user");
    const root = board.layout.root;
    expect(root.kind === "group" && root.group.sizes).toEqual([0.5, 0.5]);
    expect(Object.values(board.origins).map((o) => [o.serverId, o.workspaceId, o.agentId])).toEqual(
      expect.arrayContaining([
        ["s1", "w1", "a1"],
        ["s1", "w1", "a2"],
        ["s1", "w2", "b1"],
      ]),
    );
  });

  it("carries the workspace's open file tabs too, in the workspace's own tab order", () => {
    setWorld({ s1: { a1: {}, a2: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceFile("s1", "w1", "src/app.ts");
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: wsKey("s1", "w1"),
      target: { kind: "agent", agentId: "a2" },
      intent: "background",
    });
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const board = mustBoard(split(["w1", "w2"]));
    expect(paneEntries(board)).toEqual([["a1", "file:src/app.ts", "a2"], ["b1"]]);
    const fileOrigin = Object.values(board.origins).find((o) => o.path === "src/app.ts");
    expect(fileOrigin).toEqual({ serverId: "s1", workspaceId: "w1", path: "src/app.ts" });
    const fileTab = listBoardTabs(board.layout).find((tab) => tab.target.kind === "file");
    expect(fileTab?.target).toMatchObject({ kind: "file", path: "src/app.ts" });
  });

  it("opens the pane on a file when the workspace had a file focused", () => {
    setWorld({ s1: { a1: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceFile("s1", "w1", "README.md", "reveal");
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const board = mustBoard(split(["w1", "w2"]));
    const shown = collectAllPanes(board.layout.root).map((pane) =>
      entryOf(board, pane.focusedTabId),
    );
    expect(shown).toEqual(["file:README.md", "b1"]);
  });

  it("keeps the same file path in two workspaces (a file belongs to one workspace)", () => {
    setWorld({ s1: {} });
    openWorkspaceAgents("s1", "w1", []);
    openWorkspaceAgents("s1", "w2", []);
    openWorkspaceFile("s1", "w1", "notes.md");
    openWorkspaceFile("s1", "w2", "notes.md");
    const board = mustBoard(split(["w1", "w2"]));
    expect(paneEntries(board)).toEqual([["file:notes.md"], ["file:notes.md"]]);
    expect(
      Object.values(board.origins)
        .map((o) => o.workspaceId)
        .sort(),
    ).toEqual(["w1", "w2"]);
  });

  it("refresh keeps a file tab's id and brings newly opened files in", () => {
    setWorld({ s1: { a1: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceFile("s1", "w1", "one.ts");
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const id = split(["w1", "w2"])!;
    const fileTabId = Object.entries(mustBoard(id).origins).find(
      ([, o]) => o.path === "one.ts",
    )![0];
    openWorkspaceFile("s1", "w1", "two.ts");
    expect(split(["w1", "w2"])).toBe(id);
    const after = mustBoard(id);
    expect(paneEntries(after)).toEqual([["a1", "file:one.ts", "file:two.ts"], ["b1"]]);
    expect(after.origins[fileTabId]?.path).toBe("one.ts");
  });

  it("works across hosts and ignores non-agent tabs", () => {
    setWorld({ s1: { a1: {} }, s2: { b1: { serverId: "s2" } } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceAgents("s2", "w9", ["b1"]);
    const id = splitWorkspaces({
      workspaces: [W("w1", "s1"), W("w9", "s2")],
      layout: "columns",
      viewport: null,
    });
    const board = mustBoard(id);
    expect(paneAgents(board)).toEqual([["a1"], ["b1"]]);
    expect(Object.values(board.origins).find((o) => o.agentId === "b1")?.serverId).toBe("s2");
  });

  it("names the board from the workspace names, joined with ' | '", () => {
    setWorld(
      { s1: {} },
      { s1: { w1: "Alpha", w2: "Beta", w3: "Gamma", w4: "Delta", w5: "Epsilon" } },
    );
    expect(mustBoard(split(["w1", "w2"])).name).toBe("Alpha | Beta");
    expect(mustBoard(split(["w1", "w2", "w3"])).name).toBe("Alpha | Beta | Gamma");
    expect(mustBoard(split(["w1", "w2", "w3", "w4"])).name).toBe("Alpha | Beta | Gamma +1");
    expect(mustBoard(split(["w1", "w2", "w3", "w4", "w5"])).name).toBe("Alpha | Beta | Gamma +2");
  });

  it("prefers a workspace title, and falls back to its id", () => {
    useSessionStore.setState({
      sessions: {
        s1: {
          agents: new Map(),
          workspaces: new Map([["w1", { id: "w1", name: "dir-name", title: " Pretty " }]]),
        },
      },
    } as never);
    expect(mustBoard(split(["w1", "w-unknown"])).name).toBe("Pretty | w-unknown");
  });

  it("shows the agent each workspace has focused, else its first agent tab", () => {
    setWorld({ s1: { a1: {}, a2: {}, a3: {}, b1: {}, b2: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a2", "a3"]);
    focusWorkspaceAgent("s1", "w1", "a2");
    openWorkspaceAgents("s1", "w2", ["b1", "b2"]);
    // Focus is on the Explorer pane, which is not an agent tab.
    useWorkspaceLayoutStore.setState((state) => {
      const key = wsKey("s1", "w2");
      const layout = state.layoutByWorkspace[key]!;
      return {
        layoutByWorkspace: {
          ...state.layoutByWorkspace,
          [key]: { ...layout, focusedPaneId: "explorer" },
        },
      };
    });
    const board = mustBoard(split(["w1", "w2"]));
    expect(paneAgents(board)).toEqual([
      ["a1", "a2", "a3"],
      ["b1", "b2"],
    ]);
    expect(shownAgents(board)).toEqual(["a2", "b1"]);
  });

  it("gives overall focus to the first workspace's pane", () => {
    setWorld({ s1: { a1: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const board = mustBoard(split(["w1", "w2"]));
    expect(board.layout.focusedPaneId).toBe(collectAllPanes(board.layout.root)[0]!.id);
  });

  it("falls back to the workspace's most recent non-archived, non-subagent agents when no tabs are open", () => {
    setWorld({
      s1: {
        old: { createdAt: 1 },
        newer: { createdAt: 2 },
        gone: { archived: true, createdAt: 3 },
        child: { parent: "old", createdAt: 4 },
        elsewhere: { workspaceId: "w9", createdAt: 5 },
        b1: { workspaceId: "w2" },
      },
    });
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const board = mustBoard(split(["w1", "w2"]));
    expect(paneAgents(board).map((pane) => [...pane].sort())).toEqual([["newer", "old"], ["b1"]]);
  });

  it("an unknown workspace becomes an empty pane", () => {
    setWorld({ s1: { b1: { workspaceId: "w2" } } });
    openWorkspaceAgents("s1", "w2", ["b1"]);
    expect(paneAgents(mustBoard(split(["nowhere", "w2"])))).toEqual([[], ["b1"]]);
  });

  it("needs two distinct, valid workspaces", () => {
    expect(split(["w1"])).toBeNull();
    expect(split(["w1", "w1"])).toBeNull();
    expect(split([])).toBeNull();
    expect(
      splitWorkspaces({
        workspaces: [W("w1"), { serverId: " ", workspaceId: "w2" }],
        layout: "columns",
        viewport: null,
      }),
    ).toBeNull();
    expect(useBoardStore.getState().order).toEqual([LIVE_BOARD_ID]);
  });
});

describe("splitWorkspaces layouts", () => {
  function seed(count: number): string[] {
    const ids = Array.from({ length: count }, (_, index) => `w${index + 1}`);
    const agents: Record<string, AgentSpec> = {};
    ids.forEach((id, index) => {
      agents[`a${index + 1}`] = {};
      openWorkspaceAgents("s1", id, [`a${index + 1}`]);
    });
    setWorld({ s1: agents });
    return ids;
  }

  it.each([2, 3, 4, 5])("columns with %i workspaces: one equal column each", (count) => {
    const ids = seed(count);
    const board = mustBoard(split(ids, "columns"));
    expect(collectAllPanes(board.layout.root)).toHaveLength(count);
    expect(rowShape(board)).toEqual([count]);
    const root = board.layout.root;
    if (root.kind !== "group") {
      throw new Error("expected group");
    }
    expect(root.group.direction).toBe("horizontal");
    for (const size of root.group.sizes) {
      expect(size).toBeCloseTo(1 / count);
    }
  });

  it("grid with 4 workspaces is 2x2", () => {
    const board = mustBoard(split(seed(4), "grid", { width: 1600, height: 1000 }));
    expect(rowShape(board)).toEqual([2, 2]);
    expect(paneAgents(board).flat()).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("grid with 2, 3 and 5 workspaces follows the grid shape for the viewport", () => {
    for (const count of [2, 3, 5]) {
      const board = mustBoard(split(seed(count), "grid", { width: 1600, height: 1000 }));
      expect(rowShape(board).reduce((sum, n) => sum + n, 0)).toBe(count);
      expect(collectAllPanes(board.layout.root)).toHaveLength(count);
    }
  });

  it("grid reads the viewport, null meaning 1600x1000", () => {
    const ids = seed(2);
    const wide = mustBoard(split(ids, "grid", { width: 3000, height: 500 }));
    expect(rowShape(wide)).toEqual([2]);
    useBoardStore.setState({ splitPairs: {} });
    const tall = mustBoard(split(ids, "grid", { width: 500, height: 3000 }));
    expect(rowShape(tall)).toEqual([1, 1]);
    useBoardStore.setState({ splitPairs: {} });
    const fallback = mustBoard(split(ids, "grid", null));
    expect(collectAllPanes(fallback.layout.root)).toHaveLength(2);
  });
});

describe("splitWorkspaces reuse by set", () => {
  it("the same set in any order returns the same board and re-lays it out", () => {
    setWorld({ s1: { a1: {}, b1: {}, c1: {}, d1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceAgents("s1", "w2", ["b1"]);
    openWorkspaceAgents("s1", "w3", ["c1"]);
    openWorkspaceAgents("s1", "w4", ["d1"]);
    const first = split(["w1", "w2", "w3", "w4"], "columns");
    expect(rowShape(mustBoard(first))).toEqual([4]);
    const second = split(["w4", "w3", "w2", "w1"], "grid", { width: 1600, height: 1000 });
    expect(second).toBe(first);
    expect(rowShape(mustBoard(second))).toEqual([2, 2]);
    expect(useBoardStore.getState().order).toEqual([LIVE_BOARD_ID, first]);
  });

  it("a different set is a different board", () => {
    setWorld({ s1: {} });
    const ab = split(["w1", "w2"]);
    const abc = split(["w1", "w2", "w3"]);
    const ac = split(["w1", "w3"]);
    expect(new Set([ab, abc, ac]).size).toBe(3);
  });

  it("the same workspace id on another host is another set", () => {
    const one = splitWorkspaces({
      workspaces: [W("w1", "s1"), W("w2", "s1")],
      layout: "columns",
      viewport: null,
    });
    const two = splitWorkspaces({
      workspaces: [W("w1", "s1"), W("w2", "s2")],
      layout: "columns",
      viewport: null,
    });
    expect(one).not.toBe(two);
  });

  it("refreshes sessions from the workspaces: newly opened tabs join, closed ones leave", () => {
    setWorld({ s1: { a1: {}, a2: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a2"]);
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const id = split(["w1", "w2"])!;
    const before = mustBoard(id);
    const a1Tab = Object.entries(before.origins).find(([, o]) => o.agentId === "a1")![0];

    setWorld({ s1: { a1: {}, a2: {}, a3: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a3"]);
    expect(split(["w1", "w2"])).toBe(id);
    const after = mustBoard(id);
    expect(paneAgents(after)).toEqual([["a1", "a3"], ["b1"]]);
    // A tab that stays keeps its id, so its agent panel is not remounted.
    expect(after.origins[a1Tab]?.agentId).toBe("a1");
    expect(Object.values(after.origins).some((o) => o.agentId === "a2")).toBe(false);
  });

  it("keeps the board's focus when the focused session is still there", () => {
    setWorld({ s1: { a1: {}, a2: {}, b1: {}, b2: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a2"]);
    openWorkspaceAgents("s1", "w2", ["b1", "b2"]);
    const id = split(["w1", "w2"])!;
    const board = mustBoard(id);
    const [, right] = collectAllPanes(board.layout.root);
    const b2Tab = right!.tabIds.find((tabId) => board.origins[tabId]?.agentId === "b2")!;
    selectBoardTab(id, right!.id, b2Tab);

    expect(split(["w2", "w1"])).toBe(id);
    const after = mustBoard(id);
    const focusedPane = collectAllPanes(after.layout.root).find(
      (pane) => pane.id === after.layout.focusedPaneId,
    )!;
    expect(agentOf(after, focusedPane.focusedTabId)).toBe("b2");
  });

  it("falls back to the first workspace's pane when the focused session closed", () => {
    setWorld({ s1: { a1: {}, b1: {}, b2: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceAgents("s1", "w2", ["b1", "b2"]);
    const id = split(["w1", "w2"])!;
    const board = mustBoard(id);
    const [, right] = collectAllPanes(board.layout.root);
    const b2Tab = right!.tabIds.find((tabId) => board.origins[tabId]?.agentId === "b2")!;
    selectBoardTab(id, right!.id, b2Tab);

    openWorkspaceAgents("s1", "w2", ["b1"]);
    expect(split(["w1", "w2"])).toBe(id);
    const after = mustBoard(id);
    expect(after.layout.focusedPaneId).toBe(collectAllPanes(after.layout.root)[0]!.id);
  });

  it("clears a stale restore point, since the layout was rebuilt", () => {
    setWorld({ s1: { a1: {}, b1: {} } });
    openWorkspaceAgents("s1", "w1", ["a1"]);
    openWorkspaceAgents("s1", "w2", ["b1"]);
    const id = split(["w1", "w2"])!;
    arrangeBoard({ boardId: id, preset: "single", viewport: VIEWPORT });
    expect(getBoardArrangeState(id).snapshot).not.toBeNull();
    split(["w1", "w2"]);
    expect(getBoardArrangeState(id).snapshot).toBeNull();
  });

  it("forgets the set when its board is deleted, so the next split makes a new one", () => {
    setWorld({ s1: {} });
    const first = split(["w1", "w2"])!;
    deleteBoard(first);
    const second = split(["w1", "w2"])!;
    expect(second).not.toBe(first);
    expect(getBoard(second)).not.toBeNull();
  });

  it("arrange presets still work on a split board", () => {
    setWorld({ s1: { a1: {}, a2: {}, b1: {}, b2: {} } });
    openWorkspaceAgents("s1", "w1", ["a1", "a2"]);
    openWorkspaceAgents("s1", "w2", ["b1", "b2"]);
    const id = split(["w1", "w2"])!;
    expect(arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT })).toBe(true);
    expect(collectAllPanes(mustBoard(id).layout.root)).toHaveLength(4);
    expect(arrangeBoard({ boardId: id, preset: "grid", viewport: VIEWPORT })).toBe(true);
    expect(paneAgents(mustBoard(id))).toEqual([
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
  });
});

describe("Live board", () => {
  it("refresh builds a grid of the active agents across ALL hosts and workspaces", () => {
    setWorld({
      s1: {
        run: { state: "running", workspaceId: "w1", createdAt: 1 },
        need: { state: "attention", workspaceId: "w2", createdAt: 2 },
        idle: { state: "idle", createdAt: 3 },
      },
      s2: { other: { state: "running", workspaceId: "w7", createdAt: 4 } },
    });
    refreshLiveBoard(VIEWPORT);
    const board = mustBoard(LIVE_BOARD_ID);
    expect(board.kind).toBe("live");
    expect(agentsOnBoard(board)).toEqual(["run", "need", "other"]);
    expect(collectAllPanes(board.layout.root)).toHaveLength(3);
    expect(
      Object.values(board.origins).map((o) => `${o.serverId}/${o.workspaceId}/${o.agentId}`),
    ).toEqual(expect.arrayContaining(["s1/w1/run", "s1/w2/need", "s2/w7/other"]));
  });

  it("skips archived agents and subagents", () => {
    setWorld({
      s1: {
        run: { state: "running" },
        archived: { state: "running", archived: true },
        child: { state: "running", parent: "run" },
      },
    });
    refreshLiveBoard(VIEWPORT);
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual(["run"]);
  });

  it("refresh drops finished agents, keeps the survivors' tabs, and accepts a null viewport", () => {
    setWorld({ s1: { a: { state: "running" }, b: { state: "running" } } });
    refreshLiveBoard(null);
    const before = mustBoard(LIVE_BOARD_ID);
    const aTab = Object.entries(before.origins).find(([, o]) => o.agentId === "a")![0];
    setWorld({ s1: { a: { state: "running" }, b: { state: "idle" }, c: { state: "attention" } } });
    refreshLiveBoard(null);
    const after = mustBoard(LIVE_BOARD_ID);
    expect(agentsOnBoard(after).sort()).toEqual(["a", "c"]);
    expect(after.origins[aTab]?.agentId).toBe("a");
  });

  it("refresh with nobody active leaves one empty pane", () => {
    setWorld({ s1: { a: { state: "running" } } });
    refreshLiveBoard(VIEWPORT);
    setWorld({ s1: { a: { state: "idle" } } });
    refreshLiveBoard(VIEWPORT);
    const board = mustBoard(LIVE_BOARD_ID);
    expect(collectAllPanes(board.layout.root)).toHaveLength(1);
    expect(agentsOnBoard(board)).toEqual([]);
  });

  it("refresh resets the restore point", () => {
    setWorld({ s1: { a: { state: "running" }, b: { state: "running" } } });
    refreshLiveBoard(VIEWPORT);
    arrangeBoard({ boardId: LIVE_BOARD_ID, preset: "single", viewport: VIEWPORT });
    expect(getBoardArrangeState(LIVE_BOARD_ID).snapshot).not.toBeNull();
    refreshLiveBoard(VIEWPORT);
    expect(getBoardArrangeState(LIVE_BOARD_ID).snapshot).toBeNull();
  });
});

describe("useLiveBoardSync", () => {
  it("appends a newly active agent after the debounce, as a grid pane", () => {
    vi.useFakeTimers();
    setWorld({ s1: { a: { state: "running" } } });
    renderHook(() => useLiveBoardSync());
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(paneAgents(mustBoard(LIVE_BOARD_ID))).toEqual([["a"]]);

    act(() => {
      setWorld({ s1: { a: { state: "running" }, b: { state: "running" } } });
    });
    act(() => {
      vi.advanceTimersByTime(310);
    });
    expect(paneAgents(mustBoard(LIVE_BOARD_ID))).toEqual([["a"], ["b"]]);
  });

  it("coalesces a burst into one update", () => {
    vi.useFakeTimers();
    setWorld({ s1: { a: { state: "running" } } });
    renderHook(() => useLiveBoardSync());
    act(() => {
      vi.advanceTimersByTime(310);
    });
    const putSpy = vi.spyOn(useBoardStore.getState(), "putBoard");
    act(() => {
      setWorld({ s1: { a: { state: "running" }, b: { state: "running" } } });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      setWorld({
        s1: { a: { state: "running" }, b: { state: "running" }, c: { state: "running" } },
      });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(putSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual(["a", "b", "c"]);
  });

  it("never removes an agent that finished", () => {
    vi.useFakeTimers();
    setWorld({ s1: { a: { state: "running" }, b: { state: "running" } } });
    renderHook(() => useLiveBoardSync());
    act(() => {
      vi.advanceTimersByTime(310);
    });
    act(() => {
      setWorld({
        s1: { a: { state: "idle" }, b: { state: "running" }, c: { state: "running" } },
      });
    });
    act(() => {
      vi.advanceTimersByTime(310);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID)).sort()).toEqual(["a", "b", "c"]);
    act(() => {
      setWorld({ s1: { a: { state: "idle" }, b: { state: "idle" }, c: { state: "idle" } } });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID)).sort()).toEqual(["a", "b", "c"]);
  });

  it("grows across hosts and leaves the restore point alone", () => {
    vi.useFakeTimers();
    setWorld({ s1: { a: { state: "running" } } });
    refreshLiveBoard(VIEWPORT);
    arrangeBoard({ boardId: LIVE_BOARD_ID, preset: "single", viewport: VIEWPORT });
    const snapshot = getBoardArrangeState(LIVE_BOARD_ID).snapshot;
    renderHook(() => useLiveBoardSync());
    act(() => {
      setWorld({
        s1: { a: { state: "running" } },
        s2: { z: { state: "attention", serverId: "s2" } },
      });
    });
    act(() => {
      vi.advanceTimersByTime(310);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual(["a", "z"]);
    expect(getBoardArrangeState(LIVE_BOARD_ID).snapshot).toBe(snapshot);
    expect(getBoardArrangeState(LIVE_BOARD_ID).lastPreset).toBeNull();
  });

  it("does nothing while nobody is active, and stops after unmount", () => {
    vi.useFakeTimers();
    setWorld({ s1: { a: { state: "idle" } } });
    const hook = renderHook(() => useLiveBoardSync());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual([]);
    act(() => {
      setWorld({ s1: { a: { state: "running" } } });
    });
    hook.unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(agentsOnBoard(mustBoard(LIVE_BOARD_ID))).toEqual([]);
  });
});

describe("hooks", () => {
  it("useBoards lists summaries in order and keeps its reference while nothing changes", () => {
    const id = createBoard("One", [ref("a"), ref("b")])!;
    const { result, rerender } = renderHook(() => useBoards());
    expect(result.current).toEqual([
      { id: LIVE_BOARD_ID, name: "Live", kind: "live", sessionCount: 0 },
      { id, name: "One", kind: "user", sessionCount: 2 },
    ]);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      addSessionsToBoard(id, [ref("c")]);
    });
    expect(result.current).not.toBe(first);
    expect(result.current[1]?.sessionCount).toBe(3);
  });

  it("useBoard returns a stable board, null for none or unknown, and follows edits", () => {
    const id = createBoard("One")!;
    const { result, rerender } = renderHook(({ boardId }) => useBoard(boardId), {
      initialProps: { boardId: id as string | null },
    });
    const first = result.current;
    expect(first?.name).toBe("One");
    rerender({ boardId: id });
    expect(result.current).toBe(first);
    act(() => {
      renameBoard(id, "Two");
    });
    expect(result.current?.name).toBe("Two");
    rerender({ boardId: null });
    expect(result.current).toBeNull();
    rerender({ boardId: "ghost" });
    expect(result.current).toBeNull();
  });
});

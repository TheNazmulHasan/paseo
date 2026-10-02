import { describe, expect, it } from "vitest";
import {
  addSessionsToBoardModel,
  appendActiveSessions,
  arrangeBoardTabs,
  boardSessionKey,
  buildWorkspaceSplit,
  countBoardSessions,
  createEmptyBoardLayout,
  equalizeBoardLayout,
  findBoardTabId,
  focusBoardPaneModel,
  listBoardTabs,
  moveBoardTab,
  NO_EXPLORER_PANE_ID,
  rebuildLiveBoard,
  removeTabFromBoard,
  resizeBoardSplitModel,
  restoreBoardLayout,
  selectBoardTabModel,
  type BoardIds,
} from "@/boards/model";
import type { Board, BoardSessionRef } from "@/boards/types";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneContainingTab,
  type SplitNode,
} from "@/stores/workspace-layout-actions";

const VIEWPORT = { width: 1800, height: 1100 };

function makeIds(): BoardIds {
  let tab = 0;
  let node = 0;
  return {
    createTabId: () => `t${(tab += 1)}`,
    createNodeId: (prefix) => `${prefix}${(node += 1)}`,
    now: () => 1000,
  };
}

function ref(agentId: string, serverId = "s1", workspaceId = "w1"): BoardSessionRef {
  return { serverId, workspaceId, agentId };
}

function fileRef(path: string, serverId = "s1", workspaceId = "w1"): BoardSessionRef {
  return { serverId, workspaceId, path };
}

function emptyBoard(ids = makeIds()): Board {
  return {
    id: "b1",
    name: "B",
    createdAt: 1,
    kind: "user",
    layout: createEmptyBoardLayout(ids),
    splitSizes: {},
    origins: {},
  };
}

function withSessions(agentIds: string[], ids = makeIds()): Board {
  return addSessionsToBoardModel(
    emptyBoard(ids),
    agentIds.map((id) => ref(id)),
    ids,
  ).board;
}

function agentsOf(board: Board): string[] {
  return listBoardTabs(board.layout).map((tab) =>
    tab.target.kind === "agent" ? tab.target.agentId : "?",
  );
}

/** Agent ids per pane, in tree order. */
function paneAgents(board: Board): string[][] {
  const tabs = new Map(collectAllTabs(board.layout.root).map((tab) => [tab.tabId, tab]));
  return collectAllPanes(board.layout.root).map((pane) =>
    pane.tabIds.map((id) => {
      const target = tabs.get(id)?.target;
      return target?.kind === "agent" ? target.agentId : "?";
    }),
  );
}

function rootGroup(root: SplitNode) {
  if (root.kind !== "group") {
    throw new Error("expected a group");
  }
  return root.group;
}

function focusedAgent(board: Board, paneId: string): string | null {
  const pane = collectAllPanes(board.layout.root).find((candidate) => candidate.id === paneId);
  const tab = collectAllTabs(board.layout.root).find((t) => t.tabId === pane?.focusedTabId);
  return tab?.target.kind === "agent" ? tab.target.agentId : null;
}

describe("createEmptyBoardLayout", () => {
  it("is one focused pane with no tabs", () => {
    const layout = createEmptyBoardLayout(makeIds());
    expect(layout.root.kind).toBe("pane");
    expect(collectAllPanes(layout.root)).toHaveLength(1);
    expect(collectAllTabs(layout.root)).toHaveLength(0);
    expect(layout.focusedPaneId).toBe("pane1");
  });
});

describe("addSessionsToBoardModel", () => {
  it("adds agent tabs with origins into the focused pane and selects the last", () => {
    const ids = makeIds();
    const { board, addedTabIds } = addSessionsToBoardModel(
      emptyBoard(ids),
      [ref("a"), ref("b", "s2", "w9")],
      ids,
    );
    expect(addedTabIds).toEqual(["t1", "t2"]);
    expect(agentsOf(board)).toEqual(["a", "b"]);
    expect(board.origins.t2).toEqual({ serverId: "s2", workspaceId: "w9", agentId: "b" });
    expect(focusedAgent(board, "pane1")).toBe("b");
  });

  it("dedupes by serverId+agentId, including repeats inside one call", () => {
    const ids = makeIds();
    const first = addSessionsToBoardModel(emptyBoard(ids), [ref("a"), ref("a")], ids);
    expect(first.addedTabIds).toHaveLength(1);
    const second = addSessionsToBoardModel(first.board, [ref("a"), ref("a", "s2")], ids);
    expect(second.addedTabIds).toHaveLength(1);
    expect(agentsOf(second.board)).toEqual(["a", "a"]);
    expect(countBoardSessions(second.board)).toBe(2);
  });

  it("returns the same board when nothing is new", () => {
    const ids = makeIds();
    const board = withSessions(["a"], ids);
    const result = addSessionsToBoardModel(board, [ref("a")], ids);
    expect(result.board).toBe(board);
    expect(result.addedTabIds).toEqual([]);
  });

  it("lands in the focused pane of a multi-pane board", () => {
    const ids = makeIds();
    const split = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids,
    });
    let board: Board = { ...emptyBoard(ids), layout: split.layout, origins: split.origins };
    const rightPane = collectAllPanes(board.layout.root)[1]!;
    board = focusBoardPaneModel(board, rightPane.id);
    board = addSessionsToBoardModel(board, [ref("c")], ids).board;
    expect(paneAgents(board)).toEqual([["a"], ["b", "c"]]);
    expect(board.layout.focusedPaneId).toBe(rightPane.id);
  });

  it("generates tab ids with the default maker", () => {
    const { board } = addSessionsToBoardModel(
      { ...emptyBoard(), layout: createEmptyBoardLayout() },
      [ref("a")],
    );
    expect(Object.keys(board.origins)[0]).toMatch(/^boardtab_/);
  });
});

describe("findBoardTabId", () => {
  it("finds a session by host and agent", () => {
    const board = withSessions(["a", "b"]);
    expect(findBoardTabId(board, ref("b"))).toBe("t2");
    expect(findBoardTabId(board, ref("b", "other"))).toBeNull();
  });
});

describe("removeTabFromBoard", () => {
  it("drops the tab and its origin", () => {
    const board = removeTabFromBoard(withSessions(["a", "b"]), "t1");
    expect(agentsOf(board)).toEqual(["b"]);
    expect(Object.keys(board.origins)).toEqual(["t2"]);
  });

  it("collapses a pane it empties", () => {
    const ids = makeIds();
    const split = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids,
    });
    const board = removeTabFromBoard(
      { ...emptyBoard(ids), layout: split.layout, origins: split.origins },
      "t1",
    );
    expect(collectAllPanes(board.layout.root)).toHaveLength(1);
    expect(board.layout.root.kind).toBe("pane");
    expect(agentsOf(board)).toEqual(["b"]);
  });

  it("keeps one empty pane when the last tab goes", () => {
    const board = removeTabFromBoard(withSessions(["a"]), "t1");
    expect(collectAllPanes(board.layout.root)).toHaveLength(1);
    expect(collectAllTabs(board.layout.root)).toHaveLength(0);
    expect(board.origins).toEqual({});
    expect(board.layout.focusedPaneId).not.toBeNull();
  });

  it("ignores an unknown tab", () => {
    const board = withSessions(["a"]);
    expect(removeTabFromBoard(board, "nope")).toBe(board);
  });
});

describe("moveBoardTab / select / focus", () => {
  function twoPanes() {
    const ids = makeIds();
    const split = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a"), ref("b")] }, { sessions: [ref("c")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids,
    });
    return { ids, board: { ...emptyBoard(ids), layout: split.layout, origins: split.origins } };
  }

  it("moves a tab to another pane and focuses it", () => {
    const { board } = twoPanes();
    const [left, right] = collectAllPanes(board.layout.root);
    const moved = moveBoardTab(board, "t2", right!.id);
    expect(paneAgents(moved)).toEqual([["a"], ["c", "b"]]);
    expect(moved.layout.focusedPaneId).toBe(right!.id);
    expect(left).toBeDefined();
  });

  it("collapses the source pane when its last tab moves away", () => {
    const { board } = twoPanes();
    const [, right] = collectAllPanes(board.layout.root);
    const once = moveBoardTab(board, "t1", right!.id);
    const twice = moveBoardTab(once, "t2", right!.id);
    expect(collectAllPanes(twice.layout.root)).toHaveLength(1);
    expect(paneAgents(twice)).toEqual([["c", "a", "b"]]);
  });

  it("ignores a move to a pane that does not exist", () => {
    const { board } = twoPanes();
    expect(moveBoardTab(board, "t1", "ghost")).toBe(board);
  });

  it("selects a tab and focuses its pane", () => {
    const { board } = twoPanes();
    const [left, right] = collectAllPanes(board.layout.root);
    const focusedRight = focusBoardPaneModel(board, right!.id);
    expect(focusedRight.layout.focusedPaneId).toBe(right!.id);
    const selected = selectBoardTabModel(focusedRight, left!.id, "t2");
    expect(focusedAgent(selected, left!.id)).toBe("b");
    expect(selected.layout.focusedPaneId).toBe(left!.id);
  });

  it("selecting the already shown tab still focuses the pane", () => {
    const { board } = twoPanes();
    const [left, right] = collectAllPanes(board.layout.root);
    const selected = selectBoardTabModel(board, right!.id, "t3");
    expect(selected.layout.focusedPaneId).toBe(right!.id);
    expect(left).toBeDefined();
  });

  it("ignores selecting a tab that is not in that pane", () => {
    const { board } = twoPanes();
    const [, right] = collectAllPanes(board.layout.root);
    expect(selectBoardTabModel(board, right!.id, "t1").layout.focusedPaneId).toBe(right!.id);
    expect(focusedAgent(selectBoardTabModel(board, right!.id, "t1"), right!.id)).toBe("c");
  });

  it("leaves the board alone when the pane is already focused", () => {
    const board = withSessions(["a"]);
    expect(focusBoardPaneModel(board, board.layout.focusedPaneId!)).toBe(board);
  });
});

describe("resizeBoardSplitModel", () => {
  function split() {
    const ids = makeIds();
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids,
    });
    return { ...emptyBoard(ids), layout: built.layout, origins: built.origins };
  }

  it("stores a normalized override for the group", () => {
    const board = split();
    const groupId = rootGroup(board.layout.root).id;
    expect(resizeBoardSplitModel(board, groupId, [3, 1]).splitSizes[groupId]).toEqual([0.75, 0.25]);
  });

  it("clamps so no pane gets thinner than the minimum", () => {
    const board = split();
    const groupId = rootGroup(board.layout.root).id;
    const sizes = resizeBoardSplitModel(board, groupId, [0.99, 0.01]).splitSizes[groupId]!;
    expect(sizes[1]).toBeCloseTo(0.1);
    expect(sizes[0]! + sizes[1]!).toBeCloseTo(1);
  });

  it("ignores an unknown group or a wrong arity", () => {
    const board = split();
    const groupId = rootGroup(board.layout.root).id;
    expect(resizeBoardSplitModel(board, "ghost", [0.5, 0.5])).toBe(board);
    expect(resizeBoardSplitModel(board, groupId, [1, 1, 1])).toBe(board);
  });
});

describe("buildWorkspaceSplit", () => {
  it("columns: one equal column per group, each a tab strip", () => {
    const built = buildWorkspaceSplit({
      groups: [
        { sessions: [ref("a"), ref("b")] },
        { sessions: [ref("c")] },
        { sessions: [ref("d")] },
      ],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    const group = rootGroup(built.layout.root);
    expect(group.direction).toBe("horizontal");
    expect(group.children).toHaveLength(3);
    expect(group.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const board = { ...emptyBoard(), layout: built.layout, origins: built.origins };
    expect(paneAgents(board)).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("two workspaces make two columns of [0.5, 0.5]", () => {
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(rootGroup(built.layout.root).sizes).toEqual([0.5, 0.5]);
  });

  it("grid: panes follow computeGridShape for the viewport (4 → 2x2, 5 → 3+2 or 2+3)", () => {
    const four = buildWorkspaceSplit({
      groups: ["a", "b", "c", "d"].map((id) => ({ sessions: [ref(id)] })),
      layout: "grid",
      viewport: { width: 1600, height: 1000 },
      ids: makeIds(),
    });
    const rows = rootGroup(four.layout.root);
    expect(rows.direction).toBe("vertical");
    expect(
      rows.children.map((row) => (row.kind === "group" ? row.group.children.length : 1)),
    ).toEqual([2, 2]);

    const five = buildWorkspaceSplit({
      groups: ["a", "b", "c", "d", "e"].map((id) => ({ sessions: [ref(id)] })),
      layout: "grid",
      viewport: { width: 1600, height: 1000 },
      ids: makeIds(),
    });
    const counts = rootGroup(five.layout.root).children.map((row) =>
      row.kind === "group" ? row.group.children.length : 1,
    );
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(5);
    expect(counts.length).toBeGreaterThan(1);
  });

  it("grid with two groups in a wide window is a single row", () => {
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "grid",
      viewport: { width: 2400, height: 800 },
      ids: makeIds(),
    });
    expect(rootGroup(built.layout.root).direction).toBe("horizontal");
  });

  it("keeps an empty workspace as an empty pane", () => {
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(paneAgents({ ...emptyBoard(), layout: built.layout, origins: built.origins })).toEqual([
      ["a"],
      [],
    ]);
  });

  it("shows each group's focused agent, else its first", () => {
    const built = buildWorkspaceSplit({
      groups: [
        { sessions: [ref("a"), ref("b"), ref("c")], focused: ref("b") },
        { sessions: [ref("d"), ref("e")], focused: ref("not-there") },
        { sessions: [ref("f"), ref("g")] },
      ],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    const board = { ...emptyBoard(), layout: built.layout, origins: built.origins };
    const panes = collectAllPanes(board.layout.root);
    expect(panes.map((pane) => focusedAgent(board, pane.id))).toEqual(["b", "d", "f"]);
    // The first workspace's pane holds overall focus.
    expect(board.layout.focusedPaneId).toBe(panes[0]!.id);
  });

  it("holds file tabs next to agent tabs, in the given order, and can open on a file", () => {
    const built = buildWorkspaceSplit({
      groups: [
        { sessions: [ref("a"), fileRef("src/x.ts"), ref("b")], focused: fileRef("src/x.ts") },
        { sessions: [fileRef("y.md"), ref("c")] },
      ],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    const board = { ...emptyBoard(), layout: built.layout, origins: built.origins };
    const entry = (tabId: string | null | undefined) => {
      const target = collectAllTabs(board.layout.root).find((t) => t.tabId === tabId)?.target;
      return target?.kind === "file"
        ? `file:${target.path}`
        : (target as { agentId?: string }).agentId;
    };
    const panes = collectAllPanes(board.layout.root);
    expect(panes.map((pane) => pane.tabIds.map(entry))).toEqual([
      ["a", "file:src/x.ts", "b"],
      ["file:y.md", "c"],
    ]);
    expect(panes.map((pane) => entry(pane.focusedTabId))).toEqual(["file:src/x.ts", "file:y.md"]);
    const fileOrigin = Object.values(built.origins).find((o) => o.path === "src/x.ts");
    expect(fileOrigin).toEqual({ serverId: "s1", workspaceId: "w1", path: "src/x.ts" });
  });

  it("dedupes a file by host, workspace and path; agents by host and agent", () => {
    expect(boardSessionKey(fileRef("a.ts"))).toBe(boardSessionKey(fileRef("a.ts")));
    expect(boardSessionKey(fileRef("a.ts"))).not.toBe(boardSessionKey(fileRef("a.ts", "s1", "w2")));
    expect(boardSessionKey(fileRef("a.ts"))).not.toBe(boardSessionKey(fileRef("a.ts", "s2")));
    expect(boardSessionKey(fileRef("a.ts"))).not.toBe(boardSessionKey(ref("a.ts")));
    const built = buildWorkspaceSplit({
      groups: [
        { sessions: [fileRef("a.ts"), fileRef("a.ts")] },
        { sessions: [fileRef("a.ts", "s1", "w2"), fileRef("a.ts")] },
      ],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(Object.values(built.origins).map((o) => o.workspaceId)).toEqual(["w1", "w2"]);
  });

  it("addSessionsToBoardModel adds a file once", () => {
    const board = emptyBoard();
    const first = addSessionsToBoardModel(board, [fileRef("a.ts"), fileRef("a.ts")], makeIds());
    expect(first.addedTabIds).toHaveLength(1);
    const again = addSessionsToBoardModel(first.board, [fileRef("a.ts")], makeIds());
    expect(again.addedTabIds).toHaveLength(0);
    expect(collectAllTabs(first.board.layout.root)[0]?.target).toMatchObject({
      kind: "file",
      path: "a.ts",
    });
  });

  it("keeps given tab ids for sessions that already had one", () => {
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a"), ref("b")] }, { sessions: [ref("c")] }],
      layout: "columns",
      viewport: VIEWPORT,
      keepTabIds: new Map([[boardSessionKey(ref("b")), "keep-b"]]),
      ids: makeIds(),
    });
    expect(Object.keys(built.origins).sort()).toEqual(["keep-b", "t1", "t2"]);
    expect(built.origins["keep-b"]?.agentId).toBe("b");
  });

  it("puts a session that appears in two groups only in the first", () => {
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("a"), ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(paneAgents({ ...emptyBoard(), layout: built.layout, origins: built.origins })).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("never loses a workspace when there are more than the screen has cells", () => {
    const groups = Array.from({ length: 14 }, (_, index) => ({
      sessions: [ref(`a${index}`)],
    }));
    const built = buildWorkspaceSplit({
      groups,
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(Object.keys(built.origins)).toHaveLength(14);
    expect(collectAllPanes(built.layout.root)).toHaveLength(10);
  });

  it("with no sessions at all is one empty pane", () => {
    const built = buildWorkspaceSplit({
      groups: [],
      layout: "columns",
      viewport: VIEWPORT,
      ids: makeIds(),
    });
    expect(built.layout.root.kind).toBe("pane");
  });
});

describe("arrange, equalize, restore", () => {
  it("arranges every tab and clears size overrides", () => {
    const board = { ...withSessions(["a", "b", "c", "d"]), splitSizes: { x: [0.3, 0.7] } };
    const arranged = arrangeBoardTabs(board, { preset: "columns-2", viewport: VIEWPORT })!;
    expect(paneAgents(arranged)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(arranged.splitSizes).toEqual({});
    expect(arranged.origins).toBe(board.origins);
  });

  it("returns null on a board with no sessions", () => {
    expect(arrangeBoardTabs(emptyBoard(), { preset: "grid", viewport: VIEWPORT })).toBeNull();
  });

  it("equalizes group sizes and clears overrides", () => {
    const ids = makeIds();
    const built = buildWorkspaceSplit({
      groups: [{ sessions: [ref("a")] }, { sessions: [ref("b")] }],
      layout: "columns",
      viewport: VIEWPORT,
      ids,
    });
    const groupId = rootGroup(built.layout.root).id;
    const skewed: Board = {
      ...emptyBoard(ids),
      layout: {
        ...built.layout,
        root: {
          kind: "group",
          group: { ...rootGroup(built.layout.root), sizes: [0.8, 0.2] },
        },
      },
      origins: built.origins,
      splitSizes: { [groupId]: [0.8, 0.2] },
    };
    const equal = equalizeBoardLayout(skewed);
    expect(rootGroup(equal.layout.root).sizes).toEqual([0.5, 0.5]);
    expect(equal.splitSizes).toEqual({});
  });

  it("restores a snapshot, dropping tabs closed since and adding ones opened since", () => {
    const ids = makeIds();
    const before = withSessions(["a", "b", "c"], ids);
    const snapshot = { layout: before.layout, splitSizes: {} };
    const arranged = arrangeBoardTabs(before, { preset: "columns-3", viewport: VIEWPORT })!;
    const closed = removeTabFromBoard(arranged, "t1");
    const grown = addSessionsToBoardModel(closed, [ref("d")], ids).board;
    const restored = restoreBoardLayout(grown, snapshot, ids);
    expect(paneAgents(restored)).toEqual([["b", "c", "d"]]);
    expect(collectAllPanes(restored.layout.root)).toHaveLength(1);
    expect(restored.origins).toBe(grown.origins);
  });

  it("restore never reaches for an Explorer", () => {
    const before = withSessions(["a"]);
    const restored = restoreBoardLayout(before, { layout: before.layout, splitSizes: {} });
    expect(restored.layout.root.kind).toBe("pane");
    expect(NO_EXPLORER_PANE_ID).toBe("__no_explorer__");
  });
});

describe("appendActiveSessions (Live board growth)", () => {
  it("appends newcomers as grid panes after the current tabs, in order", () => {
    const ids = makeIds();
    const board = withSessions(["a", "b"], ids);
    const next = appendActiveSessions(board, [ref("a"), ref("c"), ref("d")], VIEWPORT, ids)!;
    expect(paneAgents(next).flat()).toEqual(["a", "b", "c", "d"]);
    expect(collectAllPanes(next.layout.root)).toHaveLength(4);
    expect(Object.keys(next.origins)).toHaveLength(4);
  });

  it("keeps existing tab ids when it re-grids", () => {
    const ids = makeIds();
    const board = withSessions(["a", "b"], ids);
    const next = appendActiveSessions(board, [ref("c")], VIEWPORT, ids)!;
    expect(findBoardTabId(next, ref("a"))).toBe("t1");
    expect(findBoardTabId(next, ref("b"))).toBe("t2");
  });

  it("is a no-op (null) when nobody is new", () => {
    const board = withSessions(["a", "b"]);
    expect(appendActiveSessions(board, [ref("a")], VIEWPORT)).toBeNull();
    expect(appendActiveSessions(board, [], VIEWPORT)).toBeNull();
  });

  it("never removes a session that is no longer active", () => {
    const ids = makeIds();
    const board = withSessions(["a", "b"], ids);
    const next = appendActiveSessions(board, [ref("c")], VIEWPORT, ids)!;
    expect(agentsOf(next)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("fills an empty Live board", () => {
    const ids = makeIds();
    const next = appendActiveSessions(emptyBoard(ids), [ref("a"), ref("b")], VIEWPORT, ids)!;
    expect(agentsOf(next)).toEqual(["a", "b"]);
  });
});

describe("rebuildLiveBoard (refresh)", () => {
  it("becomes a grid of exactly the active sessions", () => {
    const ids = makeIds();
    const board = withSessions(["a", "b", "c"], ids);
    const next = rebuildLiveBoard(board, [ref("b"), ref("d")], VIEWPORT, ids);
    expect(agentsOf(next).sort()).toEqual(["b", "d"]);
    expect(Object.keys(next.origins)).toHaveLength(2);
    expect(collectAllPanes(next.layout.root)).toHaveLength(2);
  });

  it("keeps the tab of a session that stays", () => {
    const ids = makeIds();
    const board = withSessions(["a", "b"], ids);
    const next = rebuildLiveBoard(board, [ref("b"), ref("c")], VIEWPORT, ids);
    expect(findBoardTabId(next, ref("b"))).toBe("t2");
    expect(next.splitSizes).toEqual({});
  });

  it("with nobody active is one empty pane", () => {
    const ids = makeIds();
    const next = rebuildLiveBoard(withSessions(["a"], ids), [], VIEWPORT, ids);
    expect(collectAllPanes(next.layout.root)).toHaveLength(1);
    expect(collectAllTabs(next.layout.root)).toHaveLength(0);
    expect(next.origins).toEqual({});
  });

  it("does not duplicate a session listed twice", () => {
    const ids = makeIds();
    const next = rebuildLiveBoard(emptyBoard(ids), [ref("a"), ref("a")], VIEWPORT, ids);
    expect(agentsOf(next)).toEqual(["a"]);
  });
});

describe("tab bookkeeping", () => {
  it("findPaneContainingTab sees tabs the model adds", () => {
    const board = withSessions(["a"]);
    expect(findPaneContainingTab(board.layout.root, "t1")).not.toBeNull();
  });
});

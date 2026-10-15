import { describe, expect, it } from "vitest";
import {
  addSessionsToBoardModel,
  appendActiveSessions,
  arrangeBoardPanes,
  arrangeBoardTabs,
  boardSessionKey,
  buildWorkspaceSplit,
  countBoardSessions,
  createEmptyBoardLayout,
  equalizeBoardLayout,
  findBoardTabId,
  focusBoardPaneModel,
  listBoardTabs,
  moveBoardPaneModel,
  moveBoardTab,
  NO_EXPLORER_PANE_ID,
  openDraftInPaneModel,
  openFileBesideModel,
  rebuildLiveBoard,
  removeTabFromBoard,
  resizeBoardSplitModel,
  restoreBoardLayout,
  retargetBoardTabModel,
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

/** One pane per entry (each a list of agent ids, workspace w1, w2, ...), side by side. */
function panesBoard(
  groups: string[][],
  ids = makeIds(),
  layout: "columns" | "grid" = "columns",
): { board: Board; ids: BoardIds } {
  const built = buildWorkspaceSplit({
    groups: groups.map((agents, index) => ({
      sessions: agents.map((id) => ref(id, "s1", `w${index + 1}`)),
    })),
    layout,
    viewport: VIEWPORT,
    ids,
  });
  return {
    board: { ...emptyBoard(ids), layout: built.layout, origins: built.origins },
    ids,
  };
}

function paneIds(board: Board): string[] {
  return collectAllPanes(board.layout.root).map((pane) => pane.id);
}

/** Compact tree: pane id, or H[...] / V[...] with sizes rounded to 3 decimals. */
function shape(node: SplitNode): string {
  if (node.kind === "pane") {
    return node.pane.id;
  }
  const dir = node.group.direction === "horizontal" ? "H" : "V";
  const parts = node.group.children.map((child, index) => {
    const size = Math.round((node.group.sizes[index] ?? 0) * 1000) / 1000;
    return `${shape(child)}:${size}`;
  });
  return `${dir}[${parts.join(" ")}]`;
}

function bare(id: string): SplitNode {
  return { kind: "pane", pane: { id, tabs: [], tabIds: [], focusedTabId: null } } as SplitNode;
}

function grp(id: string, direction: "horizontal" | "vertical", children: SplitNode[]): SplitNode {
  return {
    kind: "group",
    group: { id, direction, children, sizes: children.map(() => 1 / children.length) },
  } as SplitNode;
}

function withRoot(root: SplitNode, extra: Partial<Board> = {}): Board {
  return { ...emptyBoard(), layout: { root, focusedPaneId: null }, ...extra };
}

describe("arrangeBoardPanes (presets move panes, never tabs)", () => {
  const FIVE = [["a1", "a2"], ["b"], ["c1", "c2", "c3"], ["d"], ["e"]];
  const flat = (board: Board) => paneAgents(board);

  it("columns-2 keeps all five panes, dealt 3 + 2 in order, tabs intact", () => {
    const { board, ids } = panesBoard(FIVE);
    const arranged = arrangeBoardPanes(board, { preset: "columns-2", viewport: VIEWPORT }, ids)!;
    expect(flat(arranged)).toEqual(FIVE);
    expect(paneIds(arranged)).toEqual(paneIds(board));
    const root = rootGroup(arranged.layout.root);
    expect(root.direction).toBe("horizontal");
    expect(root.children.map((c) => (c.kind === "group" ? c.group.children.length : 1))).toEqual([
      3, 2,
    ]);
    for (const column of root.children) {
      expect(column.kind === "group" && column.group.direction).toBe("vertical");
    }
    expect(root.sizes).toEqual([0.5, 0.5]);
    expect(arranged.origins).toBe(board.origins);
  });

  it("columns-3 deals 2 + 2 + 1", () => {
    const { board, ids } = panesBoard(FIVE);
    const arranged = arrangeBoardPanes(board, { preset: "columns-3", viewport: VIEWPORT }, ids)!;
    expect(flat(arranged)).toEqual(FIVE);
    const root = rootGroup(arranged.layout.root);
    expect(root.children.map((c) => (c.kind === "group" ? c.group.children.length : 1))).toEqual([
      2, 2, 1,
    ]);
  });

  it("single puts every pane side by side in one equal row", () => {
    const { board, ids } = panesBoard(FIVE);
    const stacked = arrangeBoardPanes(board, { preset: "columns-2", viewport: VIEWPORT }, ids)!;
    const arranged = arrangeBoardPanes(stacked, { preset: "single", viewport: VIEWPORT }, ids)!;
    expect(flat(arranged)).toEqual(FIVE);
    const root = rootGroup(arranged.layout.root);
    expect(root.direction).toBe("horizontal");
    expect(root.children.every((c) => c.kind === "pane")).toBe(true);
    expect(root.sizes).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  it("grid keeps all five panes in Arrange's rows", () => {
    const { board, ids } = panesBoard(FIVE);
    const arranged = arrangeBoardPanes(board, { preset: "grid", viewport: VIEWPORT }, ids)!;
    expect(flat(arranged)).toEqual(FIVE);
    expect(paneIds(arranged)).toEqual(paneIds(board));
    expect(arranged.layout.root.kind).toBe("group");
  });

  it("grid on a screen too small for the panes still keeps every pane", () => {
    const { board, ids } = panesBoard(FIVE);
    const arranged = arrangeBoardPanes(
      board,
      { preset: "grid", viewport: { width: 300, height: 200 } },
      ids,
    )!;
    expect(flat(arranged)).toEqual(FIVE);
  });

  it("20 panes stay 20 under every preset", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => [`x${i}`]);
    const { board, ids } = panesBoard(twenty, makeIds(), "grid");
    expect(paneIds(board)).toHaveLength(20);
    for (const preset of ["single", "columns-2", "columns-3", "grid"] as const) {
      const arranged = arrangeBoardPanes(board, { preset, viewport: VIEWPORT }, ids)!;
      expect(flat(arranged)).toEqual(twenty);
    }
  });

  it("fewer panes than columns makes one column per pane", () => {
    const { board, ids } = panesBoard([["a"], ["b"]]);
    const arranged = arrangeBoardPanes(board, { preset: "columns-3", viewport: VIEWPORT }, ids)!;
    const root = rootGroup(arranged.layout.root);
    expect(root.children.map((c) => c.kind)).toEqual(["pane", "pane"]);
  });

  it("one pane with many tabs stays one pane", () => {
    const board = withSessions(["a", "b", "c"]);
    const arranged = arrangeBoardPanes(board, { preset: "grid", viewport: VIEWPORT })!;
    expect(arranged.layout.root.kind).toBe("pane");
    expect(paneAgents(arranged)).toEqual([["a", "b", "c"]]);
  });

  it("keeps each pane's selected tab and the focused pane, and clears size overrides", () => {
    const ids = makeIds();
    const { board } = panesBoard([["a1", "a2"], ["b"]], ids);
    const [first] = collectAllPanes(board.layout.root);
    const selected = selectBoardTabModel(board, first!.id, first!.tabIds[1]!);
    const arranged = arrangeBoardPanes(
      { ...selected, splitSizes: { g: [0.3, 0.7] } },
      { preset: "grid", viewport: VIEWPORT },
      ids,
    )!;
    expect(focusedAgent(arranged, first!.id)).toBe("a2");
    expect(arranged.layout.focusedPaneId).toBe(selected.layout.focusedPaneId);
    expect(arranged.splitSizes).toEqual({});
  });

  it("returns null on a board with no tabs", () => {
    expect(arrangeBoardPanes(emptyBoard(), { preset: "grid", viewport: VIEWPORT })).toBeNull();
  });

  it("restore brings the original layout back", () => {
    const { board, ids } = panesBoard(FIVE);
    const snapshot = { layout: board.layout, splitSizes: board.splitSizes };
    const arranged = arrangeBoardPanes(board, { preset: "columns-2", viewport: VIEWPORT }, ids)!;
    const restored = restoreBoardLayout(arranged, snapshot, ids);
    expect(restored.layout.root).toEqual(board.layout.root);
    expect(flat(restored)).toEqual(FIVE);
  });

  it("equalize evens every group of a nested layout", () => {
    const { board, ids } = panesBoard(FIVE);
    const grid = arrangeBoardPanes(board, { preset: "grid", viewport: VIEWPORT }, ids)!;
    const skewed = JSON.parse(JSON.stringify(grid)) as Board;
    const skew = (node: SplitNode) => {
      if (node.kind === "group") {
        node.group.sizes = node.group.sizes.map((_, i) =>
          i === 0 ? 0.7 : 0.3 / (node.group.sizes.length - 1),
        );
        node.group.children.forEach(skew);
      }
    };
    skew(skewed.layout.root);
    const equal = equalizeBoardLayout({ ...skewed, splitSizes: { x: [0.9, 0.1] } });
    const check = (node: SplitNode) => {
      if (node.kind === "group") {
        for (const size of node.group.sizes) {
          expect(size).toBeCloseTo(1 / node.group.children.length);
        }
        node.group.children.forEach(check);
      }
    };
    check(equal.layout.root);
    expect(equal.splitSizes).toEqual({});
  });
});

describe("moveBoardPaneModel", () => {
  function three() {
    const { board, ids } = panesBoard([["a"], ["b"], ["c"]]);
    const [p1, p2, p3] = paneIds(board) as [string, string, string];
    return { board, ids, p1, p2, p3 };
  }

  it("refuses the same pane, unknown panes and a no-op", () => {
    const { board, p1 } = three();
    expect(moveBoardPaneModel(board, p1, p1, "left")).toBeNull();
    expect(moveBoardPaneModel(board, "ghost", p1, "left")).toBeNull();
    expect(moveBoardPaneModel(board, p1, "ghost", "swap")).toBeNull();
  });

  it("swap exchanges two panes' places and keeps sizes and tabs", () => {
    const { board, p1, p2, p3 } = three();
    const swapped = moveBoardPaneModel(board, p1, p3, "swap")!;
    expect(paneIds(swapped)).toEqual([p3, p2, p1]);
    expect(paneAgents(swapped)).toEqual([["c"], ["b"], ["a"]]);
    expect(rootGroup(swapped.layout.root).sizes).toEqual(rootGroup(board.layout.root).sizes);
  });

  it("right: the pane leaves its spot and shares the target's width", () => {
    const { board, ids, p1, p2, p3 } = three();
    const moved = moveBoardPaneModel(board, p1, p3, "right", ids)!;
    expect(shape(moved.layout.root)).toBe(`H[${p2}:0.5 ${p3}:0.25 ${p1}:0.25]`);
    expect(paneAgents(moved)).toEqual([["b"], ["c"], ["a"]]);
  });

  it("left puts it before the target", () => {
    const { board, ids, p1, p2, p3 } = three();
    const moved = moveBoardPaneModel(board, p3, p2, "left", ids)!;
    expect(shape(moved.layout.root)).toBe(`H[${p1}:0.5 ${p3}:0.25 ${p2}:0.25]`);
  });

  it("above wraps the target in a vertical group of two halves", () => {
    const { board, ids, p1, p2, p3 } = three();
    const moved = moveBoardPaneModel(board, p1, p2, "above", ids)!;
    expect(shape(moved.layout.root)).toBe(`H[V[${p1}:0.5 ${p2}:0.5]:0.5 ${p3}:0.5]`);
  });

  it("below puts it under the target", () => {
    const { board, ids, p1, p3 } = three();
    const moved = moveBoardPaneModel(board, p1, p3, "below", ids)!;
    expect(rootGroup(moved.layout.root).children).toHaveLength(2);
    expect(shape(moved.layout.root)).toMatch(new RegExp(`V\\[${p3}:0.5 ${p1}:0.5\\]`));
  });

  it("two panes: moving one below the other collapses the old group into a vertical root", () => {
    const { board, ids } = panesBoard([["a"], ["b"]]);
    const [p1, p2] = paneIds(board) as [string, string];
    const moved = moveBoardPaneModel(board, p1, p2, "below", ids)!;
    expect(shape(moved.layout.root)).toBe(`V[${p2}:0.5 ${p1}:0.5]`);
  });

  it("splices a collapsed group into a same-direction parent instead of nesting", () => {
    const { board, ids, p1, p2, p3 } = three();
    const stacked = moveBoardPaneModel(board, p1, p2, "above", ids)!;
    const back = moveBoardPaneModel(stacked, p2, p3, "left", ids)!;
    const root = rootGroup(back.layout.root);
    expect(root.direction).toBe("horizontal");
    expect(root.children.every((c) => c.kind === "pane")).toBe(true);
    expect(paneIds(back)).toEqual([p1, p2, p3]);
    expect(root.sizes.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1);
  });

  it("folds stored divider drags into the move and clears the overrides", () => {
    const { board, ids, p1, p2, p3 } = three();
    const groupId = rootGroup(board.layout.root).id;
    const dragged = { ...board, splitSizes: { [groupId]: [0.5, 0.3, 0.2] } };
    const moved = moveBoardPaneModel(dragged, p3, p1, "swap", ids)!;
    expect(rootGroup(moved.layout.root).sizes).toEqual([0.5, 0.3, 0.2]);
    expect(moved.splitSizes).toEqual({});
    const right = moveBoardPaneModel(dragged, p1, p3, "right", ids)!;
    expect(shape(right.layout.root)).toBe(`H[${p2}:0.6 ${p3}:0.2 ${p1}:0.2]`);
  });

  it("keeps every pane and tab", () => {
    const { board, ids, p1, p3 } = three();
    const moved = moveBoardPaneModel(board, p1, p3, "above", ids)!;
    expect(paneIds(moved).sort()).toEqual(paneIds(board).sort());
    expect(listBoardTabs(moved.layout)).toHaveLength(3);
    expect(moved.origins).toBe(board.origins);
  });

  it("returns null when the move would nest deeper than 5", () => {
    const deep = grp("g1", "horizontal", [
      grp("g2", "vertical", [
        grp("g3", "horizontal", [grp("g4", "vertical", [bare("x"), bare("y")]), bare("z")]),
        bare("w"),
      ]),
      bare("q"),
      bare("r"),
    ]);
    const board = withRoot(deep);
    expect(moveBoardPaneModel(board, "q", "x", "left")).toBeNull();
    expect(moveBoardPaneModel(board, "q", "x", "above")).not.toBeNull();
    expect(moveBoardPaneModel(board, "q", "x", "swap")).not.toBeNull();
  });
});

describe("openFileBesideModel (files open as tabs in the same pane)", () => {
  const W1 = { serverId: "s1", workspaceId: "w1" };
  const W2 = { serverId: "s1", workspaceId: "w2" };

  /** Two workspaces side by side: pane1 = w1's agent a, pane2 = w2's agent b. */
  function twoColumns() {
    const { board, ids } = panesBoard([["a"], ["b"]]);
    const [left, right] = paneIds(board) as [string, string];
    return { board, left, right, ids };
  }

  function entries(board: Board, paneId: string): string[] {
    const pane = collectAllPanes(board.layout.root).find((candidate) => candidate.id === paneId);
    return (pane?.tabIds ?? []).map((id) => {
      const origin = board.origins[id];
      return origin?.agentId ?? `file:${origin?.path}`;
    });
  }

  it("adds the file as the selected last tab of the source pane, no new pane", () => {
    const { board, left, right, ids } = twoColumns();
    const result = openFileBesideModel(
      board,
      { sourcePaneId: left, origin: W1, location: { path: "src/a.ts" } },
      ids,
    )!;
    expect(result.paneId).toBe(left);
    expect(paneIds(result.board)).toEqual([left, right]);
    expect(entries(result.board, left)).toEqual(["a", "file:src/a.ts"]);
    expect(entries(result.board, right)).toEqual(["b"]);
    const pane = collectAllPanes(result.board.layout.root)[0]!;
    expect(pane.focusedTabId).toBe(result.tabId);
    expect(result.board.layout.focusedPaneId).toBe(left);
    expect(result.board.origins[result.tabId]).toEqual({ ...W1, path: "src/a.ts" });
    const tab = collectAllTabs(result.board.layout.root).find((t) => t.tabId === result.tabId);
    expect(tab?.target).toMatchObject({ kind: "file", path: "src/a.ts" });
  });

  it("does not duplicate a file already open in the source pane, only selects it", () => {
    const { board, left, ids } = twoColumns();
    const first = openFileBesideModel(
      board,
      { sourcePaneId: left, origin: W1, location: { path: "a.ts" } },
      ids,
    )!;
    const other = openFileBesideModel(
      first.board,
      { sourcePaneId: left, origin: W1, location: { path: "b.ts" } },
      ids,
    )!;
    const again = openFileBesideModel(
      other.board,
      { sourcePaneId: left, origin: W1, location: { path: "a.ts" } },
      ids,
    )!;
    expect(again.tabId).toBe(first.tabId);
    expect(entries(again.board, left)).toEqual(["a", "file:a.ts", "file:b.ts"]);
    expect(collectAllPanes(again.board.layout.root)[0]!.focusedTabId).toBe(first.tabId);
  });

  it("focuses the file where it already is when another pane of the workspace has it", () => {
    const { board, left, right, ids } = twoColumns();
    const inRight = openFileBesideModel(
      board,
      { sourcePaneId: right, origin: W2, location: { path: "x.ts" } },
      ids,
    )!;
    const asked = openFileBesideModel(
      inRight.board,
      { sourcePaneId: left, origin: W2, location: { path: "x.ts" } },
      ids,
    )!;
    expect(asked.tabId).toBe(inRight.tabId);
    expect(asked.paneId).toBe(right);
    expect(asked.board.layout.focusedPaneId).toBe(right);
    expect(entries(asked.board, left)).toEqual(["a"]);
    expect(listBoardTabs(asked.board.layout)).toHaveLength(3);
  });

  it("the same path in another workspace is a different file", () => {
    const { board, left, ids } = twoColumns();
    const one = openFileBesideModel(
      board,
      { sourcePaneId: left, origin: W1, location: { path: "a.ts" } },
      ids,
    )!;
    const two = openFileBesideModel(
      one.board,
      { sourcePaneId: left, origin: W2, location: { path: "a.ts" } },
      ids,
    )!;
    expect(two.tabId).not.toBe(one.tabId);
    expect(entries(two.board, left)).toEqual(["a", "file:a.ts", "file:a.ts"]);
  });

  it("returns null for an unknown pane or a blank path", () => {
    const { board, left, ids } = twoColumns();
    expect(
      openFileBesideModel(
        board,
        { sourcePaneId: "ghost", origin: W1, location: { path: "a" } },
        ids,
      ),
    ).toBeNull();
    expect(
      openFileBesideModel(board, { sourcePaneId: left, origin: W1, location: { path: "  " } }, ids),
    ).toBeNull();
  });
});

describe("openDraftInPaneModel / retargetBoardTabModel", () => {
  function twoColumns() {
    const base = makeIds();
    const ids: BoardIds = { ...base, createDraftId: () => "draft_1" };
    const { board } = panesBoard([["a"], ["b"]], ids);
    const [left, right] = paneIds(board) as [string, string];
    return { board, left, right, ids };
  }

  it("adds a selected draft tab to the pane, owned by the pane's workspace", () => {
    const { board, right, ids } = twoColumns();
    const result = openDraftInPaneModel(board, right, ids)!;
    const pane = collectAllPanes(result.board.layout.root)[1]!;
    expect(pane.tabIds).toHaveLength(2);
    expect(pane.focusedTabId).toBe(result.tabId);
    expect(result.board.layout.focusedPaneId).toBe(right);
    const tab = collectAllTabs(result.board.layout.root).find((t) => t.tabId === result.tabId);
    expect(tab?.target).toEqual({ kind: "draft", draftId: "draft_1" });
    expect(result.board.origins[result.tabId]).toEqual({ serverId: "s1", workspaceId: "w2" });
    expect(paneIds(result.board)).toEqual(paneIds(board));
  });

  it("generates a draft id when none is injected", () => {
    const { board, left } = twoColumns();
    const result = openDraftInPaneModel(board, left)!;
    const tab = collectAllTabs(result.board.layout.root).find((t) => t.tabId === result.tabId);
    expect(tab?.target.kind === "draft" && tab.target.draftId.length).toBeGreaterThan(0);
  });

  it("falls back to the first tab's workspace when the focused tab has no origin", () => {
    const { board, left, ids } = twoColumns();
    const pane = collectAllPanes(board.layout.root)[0]!;
    const broken: Board = {
      ...board,
      layout: {
        ...board.layout,
        root: {
          kind: "group",
          group: {
            ...rootGroup(board.layout.root),
            children: rootGroup(board.layout.root).children.map((child) =>
              child.kind === "pane" && child.pane.id === left
                ? { kind: "pane", pane: { ...child.pane, focusedTabId: "ghost" } }
                : child,
            ),
          },
        },
      } as Board["layout"],
    };
    expect(pane.tabIds).toHaveLength(1);
    const result = openDraftInPaneModel(broken, left, ids)!;
    expect(result.board.origins[result.tabId]).toEqual({ serverId: "s1", workspaceId: "w1" });
  });

  it("returns null for an unknown pane and for a pane with no tab to name its workspace", () => {
    const { board, ids } = twoColumns();
    expect(openDraftInPaneModel(board, "ghost", ids)).toBeNull();
    const empty = emptyBoard();
    expect(openDraftInPaneModel(empty, "pane1", ids)).toBeNull();
  });

  it("retargets a draft into an agent in place, keeping id and slot, updating the origin", () => {
    const { board, left, ids } = twoColumns();
    const drafted = openDraftInPaneModel(board, left, ids)!;
    const next = retargetBoardTabModel(drafted.board, drafted.tabId, {
      kind: "agent",
      agentId: "new1",
    });
    const pane = collectAllPanes(next.layout.root)[0]!;
    expect(pane.tabIds).toEqual([...pane.tabIds.slice(0, 1), drafted.tabId]);
    const tab = collectAllTabs(next.layout.root).find((t) => t.tabId === drafted.tabId);
    expect(tab?.target).toEqual({ kind: "agent", agentId: "new1" });
    expect(next.origins[drafted.tabId]).toEqual({
      serverId: "s1",
      workspaceId: "w1",
      agentId: "new1",
    });
    expect(findBoardTabId(next, ref("new1"))).toBe(drafted.tabId);
  });

  it("retargets to a file by path, and ignores an unknown tab", () => {
    const { board, left, ids } = twoColumns();
    const drafted = openDraftInPaneModel(board, left, ids)!;
    const next = retargetBoardTabModel(drafted.board, drafted.tabId, {
      kind: "file",
      path: "x.ts",
    } as never);
    expect(next.origins[drafted.tabId]).toEqual({
      serverId: "s1",
      workspaceId: "w1",
      path: "x.ts",
    });
    expect(retargetBoardTabModel(board, "ghost", { kind: "agent", agentId: "z" })).toBe(board);
  });
});

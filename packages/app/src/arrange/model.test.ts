import { describe, expect, it } from "vitest";
import {
  arrangeLayoutTabs,
  collectArrangeTabs,
  computeGridShape,
  equalizeLayout,
  pruneSplitSizes,
  reconcileSnapshot,
} from "@/arrange/model";
import type { SplitPane, WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { getTreeDepth } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";

const VIEWPORT = { width: 1800, height: 1100 };

function tab(id: string): WorkspaceTab {
  return { tabId: id, target: { kind: "agent", agentId: id }, createdAt: 1 };
}

// The internal pane type (with `tabs`) is what the store holds at runtime.
interface PaneNode {
  kind: "pane";
  pane: SplitPane & { tabs: WorkspaceTab[] };
}
interface GroupNode {
  kind: "group";
  group: { id: string; direction: "horizontal" | "vertical"; children: Node[]; sizes: number[] };
}
type Node = PaneNode | GroupNode;

function pane(id: string, tabIds: string[], options: { hidden?: boolean; focused?: string } = {}) {
  const node: PaneNode = {
    kind: "pane",
    pane: {
      id,
      tabs: tabIds.map(tab),
      tabIds,
      focusedTabId: options.focused ?? tabIds[0] ?? null,
      ...(options.hidden ? { hidden: true } : {}),
    },
  };
  return node;
}

function group(
  id: string,
  direction: "horizontal" | "vertical",
  children: Node[],
  sizes?: number[],
): GroupNode {
  return {
    kind: "group",
    group: { id, direction, children, sizes: sizes ?? children.map(() => 1 / children.length) },
  };
}

function layoutOf(root: Node, focusedPaneId: string | null = "main"): WorkspaceLayout {
  return { root: root as WorkspaceLayout["root"], focusedPaneId };
}

/** The stock shape: one main pane plus the hidden Explorer, as createWorkspaceLayoutWithExplorerSidebar. */
function stockLayout(mainTabs: string[], explorerHidden = true): WorkspaceLayout {
  return layoutOf(
    group(
      "workspace-root",
      "horizontal",
      [
        pane("main", mainTabs),
        pane("explorer", ["files", "changes"], { hidden: explorerHidden, focused: "changes" }),
      ],
      [0.78, 0.22],
    ),
  );
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `t${index + 1}`);
}

function counter(): (prefix: "pane" | "group") => string {
  let next = 0;
  return (prefix) => {
    next += 1;
    return `${prefix}-new-${next}`;
  };
}

function nodeOf(layout: WorkspaceLayout): Node {
  return layout.root as Node;
}

function explorerNode(layout: WorkspaceLayout): PaneNode {
  const found = findPane(nodeOf(layout), "explorer");
  if (!found) {
    throw new Error("explorer missing");
  }
  return found;
}

function findPane(node: Node, paneId: string): PaneNode | null {
  if (node.kind === "pane") {
    return node.pane.id === paneId ? node : null;
  }
  for (const child of node.group.children) {
    const hit = findPane(child, paneId);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** The main area, as the renderer sees it: the tree without the Explorer. */
function mainPanes(layout: WorkspaceLayout): PaneNode[] {
  const out: PaneNode[] = [];
  const visit = (node: Node) => {
    if (node.kind === "pane") {
      if (node.pane.id !== "explorer") {
        out.push(node);
      }
      return;
    }
    node.group.children.forEach(visit);
  };
  visit(nodeOf(layout));
  return out;
}

function mainTree(layout: WorkspaceLayout): Node {
  const root = nodeOf(layout);
  if (root.kind === "group") {
    const rest = root.group.children.filter(
      (child) => !(child.kind === "pane" && child.pane.id === "explorer"),
    );
    return rest.length === 1 && rest[0] ? rest[0] : root;
  }
  return root;
}

function shapeOf(node: Node): unknown {
  if (node.kind === "pane") {
    return node.pane.tabIds.join("+");
  }
  return { [node.group.direction]: node.group.children.map(shapeOf) };
}

describe("computeGridShape", () => {
  it("matches the 16:10 1800x1100 table", () => {
    const table: Array<[number, number[]]> = [
      [1, [1]],
      [2, [2]],
      [3, [3]],
      [4, [2, 2]],
      [5, [3, 2]],
      [6, [3, 3]],
      [7, [4, 3]],
      [8, [4, 4]],
      [9, [3, 3, 3]],
      [10, [5, 5]],
      [12, [4, 4, 4]],
    ];
    for (const [count, rowCounts] of table) {
      expect(computeGridShape(count, VIEWPORT).rowCounts, `count ${count}`).toEqual(rowCounts);
    }
  });

  it("uses wider rows when the width allows them", () => {
    expect(computeGridShape(12, { width: 2400, height: 1100 }).rowCounts).toEqual([6, 6]);
  });

  it("stacks rows on a portrait window", () => {
    expect(computeGridShape(2, { width: 700, height: 1400 }).rowCounts).toEqual([1, 1]);
  });

  it("caps columns by width and rows by height, returning the capacity shape on overflow", () => {
    // 900/360 -> 2 columns, 500/220 -> 2 rows: room for 4.
    expect(computeGridShape(9, { width: 900, height: 500 }).rowCounts).toEqual([2, 2]);
    expect(computeGridShape(40, VIEWPORT).rowCounts).toEqual([5, 5, 5, 5, 5]);
  });

  it("never returns an empty row, and always accounts for every pane when it fits", () => {
    for (let count = 1; count <= 25; count += 1) {
      const { rowCounts } = computeGridShape(count, VIEWPORT);
      expect(rowCounts.every((value) => value >= 1)).toBe(true);
      expect(rowCounts.reduce((sum, value) => sum + value, 0)).toBe(count);
    }
  });

  it("survives a tiny, zero or non-finite viewport", () => {
    expect(computeGridShape(3, { width: 100, height: 100 }).rowCounts).toEqual([1]);
    expect(computeGridShape(2, { width: 0, height: Number.NaN }).rowCounts.length).toBeGreaterThan(
      0,
    );
    expect(computeGridShape(0, VIEWPORT).rowCounts).toEqual([]);
  });

  it("honours custom minimum pane sizes", () => {
    expect(computeGridShape(4, VIEWPORT, 900, 220).rowCounts).toEqual([2, 2]);
    expect(computeGridShape(6, VIEWPORT, 900, 550).rowCounts).toEqual([2, 2]);
  });
});

describe("arrangeLayoutTabs", () => {
  it("single puts every tab in one pane and keeps the Explorer where it is", () => {
    const layout = stockLayout(["t1", "t2", "t3"]);
    const next = arrangeLayoutTabs(layout, {
      tabIds: ["t1", "t2", "t3"],
      preset: "single",
      viewport: VIEWPORT,
      createNodeId: counter(),
    });
    expect(next).not.toBeNull();
    expect(shapeOf(mainTree(next!))).toBe("t1+t2+t3");
    expect(next!.focusedPaneId).toBe("main");
  });

  it("columns-2 deals contiguous even chunks into side-by-side panes", () => {
    const next = arrangeLayoutTabs(stockLayout(ids(5)), {
      tabIds: ids(5),
      preset: "columns-2",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(next))).toEqual({ horizontal: ["t1+t2+t3", "t4+t5"] });
    expect(mainTree(next).kind === "group" && (mainTree(next) as GroupNode).group.sizes).toEqual([
      0.5, 0.5,
    ]);
  });

  it("columns-3 caps the pane count at the number of tabs", () => {
    const next = arrangeLayoutTabs(stockLayout(ids(2)), {
      tabIds: ids(2),
      preset: "columns-3",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(next))).toEqual({ horizontal: ["t1", "t2"] });
    const three = arrangeLayoutTabs(stockLayout(ids(7)), {
      tabIds: ids(7),
      preset: "columns-3",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(three))).toEqual({ horizontal: ["t1+t2+t3", "t4+t5", "t6+t7"] });
  });

  it("a single selected tab under columns collapses to one plain pane", () => {
    const next = arrangeLayoutTabs(stockLayout(ids(3)), {
      tabIds: ["t2"],
      preset: "columns-2",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(mainTree(next).kind).toBe("pane");
  });

  it("grid builds a vertical group of rows with one tab per pane", () => {
    const next = arrangeLayoutTabs(stockLayout(ids(5)), {
      tabIds: ids(5),
      preset: "grid",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(next))).toEqual({
      vertical: [{ horizontal: ["t1", "t2", "t3"] }, { horizontal: ["t4", "t5"] }],
    });
    for (const node of mainPanes(next)) {
      expect(node.pane.focusedTabId).toBe(node.pane.tabIds[0]);
    }
  });

  it("grid with one row has no vertical wrapper, and with one tab is one pane", () => {
    const row = arrangeLayoutTabs(stockLayout(ids(3)), {
      tabIds: ids(3),
      preset: "grid",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(row))).toEqual({ horizontal: ["t1", "t2", "t3"] });
    const one = arrangeLayoutTabs(stockLayout(ids(1)), {
      tabIds: ids(1),
      preset: "grid",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(mainTree(one).kind).toBe("pane");
  });

  it("grid stacks overflow tabs round-robin when the screen is full", () => {
    // 900x500 fits a 2x2 grid; 6 tabs overflow by 2.
    const next = arrangeLayoutTabs(stockLayout(ids(6)), {
      tabIds: ids(6),
      preset: "grid",
      viewport: { width: 900, height: 500 },
      createNodeId: counter(),
    })!;
    expect(shapeOf(mainTree(next))).toEqual({
      vertical: [{ horizontal: ["t1+t5", "t2+t6"] }, { horizontal: ["t3", "t4"] }],
    });
    // The first tab of each pane is the one on show.
    expect(mainPanes(next)[0]?.pane.focusedTabId).toBe("t1");
  });

  it("puts unselected tabs at the end of the first pane and never drops one", () => {
    const layout = layoutOf(
      group(
        "workspace-root",
        "horizontal",
        [
          group("g", "horizontal", [pane("main", ["a", "b", "c"]), pane("p2", ["d", "e"])]),
          pane("explorer", ["files"], { hidden: true }),
        ],
        [0.8, 0.2],
      ),
    );
    const next = arrangeLayoutTabs(layout, {
      tabIds: ["d", "a"],
      preset: "columns-2",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    const panes = mainPanes(next);
    expect(panes.map((node) => node.pane.tabIds)).toEqual([["d", "b", "c", "e"], ["a"]]);
    expect(panes[0]?.pane.focusedTabId).toBe("d");
    expect(new Set(collectArrangeTabs(next).map((entry) => entry.tabId))).toEqual(
      new Set(["a", "b", "c", "d", "e"]),
    );
  });

  it("ignores unknown and duplicate ids, and returns null when nothing is arrangeable", () => {
    const layout = stockLayout(["a", "b"]);
    const next = arrangeLayoutTabs(layout, {
      tabIds: ["a", "a", "ghost"],
      preset: "single",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(mainPanes(next)[0]?.pane.tabIds).toEqual(["a", "b"]);
    expect(
      arrangeLayoutTabs(layout, {
        tabIds: ["ghost"],
        preset: "single",
        viewport: VIEWPORT,
      }),
    ).toBeNull();
  });

  it("does not arrange the Explorer's own tabs and leaves its pane untouched", () => {
    for (const hidden of [true, false]) {
      const layout = stockLayout(ids(4), hidden);
      const before = explorerNode(layout);
      const next = arrangeLayoutTabs(layout, {
        tabIds: ["files", ...ids(4)],
        preset: "grid",
        viewport: VIEWPORT,
        createNodeId: counter(),
      })!;
      expect(explorerNode(next)).toBe(before);
      expect(explorerNode(next).pane.hidden).toBe(hidden ? true : undefined);
      expect(collectArrangeTabs(next).map((entry) => entry.tabId)).toEqual(ids(4));
      const root = nodeOf(next) as GroupNode;
      expect(root.group.id).toBe("workspace-root");
      expect(root.group.children[1]).toBe(before);
      expect(root.group.sizes).toEqual([0.78, 0.22]);
    }
  });

  it("keeps an Explorer that sits first on the left", () => {
    const layout = layoutOf(
      group(
        "workspace-root",
        "horizontal",
        [pane("explorer", ["files"], { hidden: true }), pane("main", ids(2))],
        [0.25, 0.75],
      ),
    );
    const next = arrangeLayoutTabs(layout, {
      tabIds: ids(2),
      preset: "columns-2",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    const root = nodeOf(next) as GroupNode;
    expect(root.group.children[0]).toBe(explorerNode(next));
    expect(root.group.sizes).toEqual([0.25, 0.75]);
  });

  it("re-docks a nested or root-level Explorer beside the new main area", () => {
    const nested = layoutOf(
      group("g1", "vertical", [
        pane("main", ids(2)),
        group("g2", "horizontal", [
          pane("p2", ["x"]),
          pane("explorer", ["files"], { hidden: true }),
        ]),
      ]),
    );
    const next = arrangeLayoutTabs(nested, {
      tabIds: [...ids(2), "x"],
      preset: "single",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    const root = nodeOf(next) as GroupNode;
    expect(root.group.direction).toBe("horizontal");
    expect(root.group.children).toHaveLength(2);
    expect(findPane(nodeOf(next), "explorer")).not.toBeNull();
  });

  it("works on a layout with no Explorer", () => {
    const layout = layoutOf(pane("main", ids(4)));
    const next = arrangeLayoutTabs(layout, {
      tabIds: ids(4),
      preset: "columns-2",
      viewport: VIEWPORT,
      explorerPaneId: null,
      createNodeId: counter(),
    })!;
    expect(shapeOf(nodeOf(next))).toEqual({ horizontal: ["t1+t2", "t3+t4"] });
  });

  it("reuses existing pane ids in order and mints new ones for the rest", () => {
    const layout = layoutOf(
      group("g", "horizontal", [
        pane("main", ["a", "c"]),
        pane("p2", ["b"]),
        pane("explorer", ["files"], { hidden: true }),
      ]),
    );
    const next = arrangeLayoutTabs(layout, {
      tabIds: ["a", "b", "c"],
      preset: "columns-3",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(mainPanes(next).map((node) => node.pane.id)).toEqual(["main", "p2", "pane-new-1"]);
  });

  it("keeps every layout within the depth limit and focuses the first pane", () => {
    for (const preset of ["single", "columns-2", "columns-3", "grid"] as const) {
      for (const count of [1, 2, 3, 6, 12, 30]) {
        const next = arrangeLayoutTabs(stockLayout(ids(count)), {
          tabIds: ids(count),
          preset,
          viewport: VIEWPORT,
          createNodeId: counter(),
        })!;
        expect(getTreeDepth(next.root), `${preset}/${count}`).toBeLessThanOrEqual(5);
        expect(next.focusedPaneId).toBe(mainPanes(next)[0]?.pane.id);
      }
    }
  });

  it("carries parentTabIdByTabId across", () => {
    const layout: WorkspaceLayout = { ...stockLayout(ids(2)), parentTabIdByTabId: { t2: "t1" } };
    const next = arrangeLayoutTabs(layout, {
      tabIds: ids(2),
      preset: "single",
      viewport: VIEWPORT,
      createNodeId: counter(),
    })!;
    expect(next.parentTabIdByTabId).toEqual({ t2: "t1" });
  });

  it("does not mutate its input", () => {
    const layout = stockLayout(ids(4));
    const before = JSON.stringify(layout);
    arrangeLayoutTabs(layout, {
      tabIds: ids(4),
      preset: "grid",
      viewport: VIEWPORT,
      createNodeId: counter(),
    });
    expect(JSON.stringify(layout)).toBe(before);
  });
});

describe("equalizeLayout", () => {
  it("makes every group's sizes equal", () => {
    const layout = layoutOf(
      group(
        "root",
        "vertical",
        [
          group(
            "row",
            "horizontal",
            [pane("a", ["1"]), pane("b", ["2"]), pane("c", ["3"])],
            [0.7, 0.2, 0.1],
          ),
          pane("d", ["4"]),
        ],
        [0.9, 0.1],
      ),
    );
    const next = nodeOf(equalizeLayout(layout, null)) as GroupNode;
    expect(next.group.sizes).toEqual([0.5, 0.5]);
    expect(
      (next.group.children[0] as GroupNode).group.sizes.map((s) => Number(s.toFixed(6))),
    ).toEqual([0.333333, 0.333333, 0.333333]);
  });

  it("evens the panes beside the Explorer without resizing the Explorer", () => {
    const layout = layoutOf(
      group(
        "root",
        "horizontal",
        [pane("a", ["1"]), pane("b", ["2"]), pane("explorer", ["f"], { hidden: true })],
        [0.6, 0.2, 0.2],
      ),
    );
    const sizes = (nodeOf(equalizeLayout(layout)) as GroupNode).group.sizes;
    expect(sizes[2]).toBeCloseTo(0.2);
    expect(sizes[0]).toBeCloseTo(0.4);
    expect(sizes[1]).toBeCloseTo(0.4);
  });

  it("leaves panes and the Explorer pane object alone", () => {
    const layout = stockLayout(["a"], false);
    const next = equalizeLayout(layout);
    expect(explorerNode(next)).toBe(explorerNode(layout));
  });
});

describe("reconcileSnapshot", () => {
  const current = (tabIds: string[]) => tabIds.map(tab);

  it("drops tabs that no longer exist", () => {
    const snapshot = stockLayout(["a", "b", "c"]);
    const next = reconcileSnapshot(snapshot, current(["a", "c"]), { createNodeId: counter() });
    expect(mainPanes(next)[0]?.pane.tabIds).toEqual(["a", "c"]);
  });

  it("repoints focus when the focused tab was dropped", () => {
    const snapshot = layoutOf(
      group("g", "horizontal", [
        pane("main", ["a", "b"], { focused: "b" }),
        pane("explorer", ["f"], { hidden: true }),
      ]),
    );
    const next = reconcileSnapshot(snapshot, current(["a"]));
    expect(mainPanes(next)[0]?.pane.focusedTabId).toBe("a");
  });

  it("appends tabs that exist now to the snapshot's focused pane", () => {
    const snapshot = layoutOf(
      group("g", "horizontal", [
        group("row", "horizontal", [pane("main", ["a"]), pane("p2", ["b"])]),
        pane("explorer", ["f"], { hidden: true }),
      ]),
      "p2",
    );
    const next = reconcileSnapshot(snapshot, current(["a", "b", "new1", "new2"]));
    const panes = mainPanes(next);
    expect(panes.map((node) => node.pane.tabIds)).toEqual([["a"], ["b", "new1", "new2"]]);
    expect(next.focusedPaneId).toBe("p2");
  });

  it("falls back to the first pane when the focused pane is gone or is the Explorer", () => {
    const snapshot = layoutOf(
      group("g", "horizontal", [pane("main", ["a"]), pane("explorer", ["f"], { hidden: true })]),
      "explorer",
    );
    const next = reconcileSnapshot(snapshot, current(["a", "z"]));
    expect(mainPanes(next)[0]?.pane.tabIds).toEqual(["a", "z"]);
    expect(next.focusedPaneId).toBe("main");
  });

  it("removes panes left empty and collapses single-child groups", () => {
    const snapshot = layoutOf(
      group(
        "g",
        "horizontal",
        [
          group("row", "vertical", [pane("main", ["a"]), pane("p2", ["b"])], [0.5, 0.5]),
          pane("p3", ["c"]),
          pane("explorer", ["f"], { hidden: true }),
        ],
        [0.4, 0.4, 0.2],
      ),
    );
    const next = reconcileSnapshot(snapshot, current(["a", "c"]));
    expect(shapeOf(nodeOf(next))).toEqual({ horizontal: ["a", "c", "f"] });
    const root = nodeOf(next) as GroupNode;
    expect(root.group.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
    expect(root.group.sizes[2]).toBeCloseTo(0.2);
  });

  it("removes an emptied first pane too when other panes still hold tabs", () => {
    const snapshot = layoutOf(
      group("g", "horizontal", [
        pane("main", ["a"]),
        pane("p2", ["b"]),
        pane("explorer", ["f"], { hidden: true }),
      ]),
    );
    const next = reconcileSnapshot(snapshot, current(["b"]));
    expect(mainPanes(next).map((node) => node.pane.id)).toEqual(["p2"]);
    expect(next.focusedPaneId).toBe("p2");
  });

  it("docks the current Explorer when the snapshot had none", () => {
    const snapshot = layoutOf(pane("main", ["a"]));
    const liveExplorer = explorerNode(stockLayout([], true)).pane;
    const next = reconcileSnapshot(snapshot, current(["a"]), { currentExplorerPane: liveExplorer });
    expect(explorerNode(next).pane).toBe(liveExplorer);
    expect(mainPanes(next).map((node) => node.pane.tabIds)).toEqual([["a"]]);
  });

  it("never removes the last pane, even when nothing is left in it", () => {
    const snapshot = stockLayout(["a", "b"]);
    const next = reconcileSnapshot(snapshot, []);
    expect(mainPanes(next)).toHaveLength(1);
    expect(mainPanes(next)[0]?.pane.tabIds).toEqual([]);
    expect(next.focusedPaneId).toBe("main");
  });

  it("uses the current Explorer pane instead of the snapshot's", () => {
    const snapshot = stockLayout(["a"], true);
    const liveExplorer = explorerNode(stockLayout(["a"], false)).pane;
    const next = reconcileSnapshot(snapshot, current(["a"]), { currentExplorerPane: liveExplorer });
    expect(explorerNode(next).pane).toBe(liveExplorer);
    expect(explorerNode(next).pane.hidden).toBeUndefined();
  });

  it("swaps in the live tab objects and keeps only parent links between open tabs", () => {
    const snapshot: WorkspaceLayout = {
      ...stockLayout(["a", "b"]),
      parentTabIdByTabId: { b: "a", a: "gone" },
    };
    const fresh = { ...tab("a"), state: { fresh: true } } as WorkspaceTab;
    const next = reconcileSnapshot(snapshot, [fresh, tab("b")]);
    expect(mainPanes(next)[0]?.pane.tabs[0]).toBe(fresh);
    expect(next.parentTabIdByTabId).toEqual({ b: "a" });
  });

  it("gives the tabs a pane when the snapshot only held the Explorer", () => {
    const snapshot = layoutOf(pane("explorer", ["f"], { hidden: true }), "explorer");
    const next = reconcileSnapshot(snapshot, current(["a"]), { createNodeId: counter() });
    expect(mainPanes(next).map((node) => node.pane.tabIds)).toEqual([["a"]]);
    expect(findPane(nodeOf(next), "explorer")).not.toBeNull();
  });

  it("does not mutate the snapshot", () => {
    const snapshot = stockLayout(["a", "b"]);
    const before = JSON.stringify(snapshot);
    reconcileSnapshot(snapshot, current(["a", "q"]));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("pruneSplitSizes", () => {
  it("keeps overrides for groups that still exist with the same child count", () => {
    const layout = stockLayout(["a"]);
    expect(
      pruneSplitSizes(layout, {
        "workspace-root": [0.6, 0.4],
        "workspace-root-wrong-arity": [1],
        gone: [0.5, 0.5],
      }),
    ).toEqual({ "workspace-root": [0.6, 0.4] });
    expect(pruneSplitSizes(layout, { "workspace-root": [0.3, 0.3, 0.4] })).toEqual({});
  });
});

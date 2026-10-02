import { describe, expect, it } from "vitest";
import {
  BOARD_HANDLED_ACTION_IDS,
  boardWorkspaceKey,
  buildBoardRoute,
  countVisibleBoardTabs,
  findBoardPane,
  groupBoardVisibleAgents,
  orderBoardSwitcherTabIds,
  recordBoardTabUse,
  resolveAdjacentBoardPaneId,
  resolveIndexedTabId,
  resolveRelativeTabId,
  resolveRenderableTabIds,
  resolveBoardGroupFlex,
  resolveBoardGroupSizes,
  resolveBoardKeyCommand,
  resolveBoardViewport,
  resolvePaneActiveTabId,
} from "@/boards/screen-helpers";
import { BOARD_ROUTED_ACTION_IDS } from "@/boards/keyboard-contract";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { BoardTabOrigin } from "@/boards/types";
import type { SplitGroup, SplitNode, SplitPane } from "@/stores/workspace-layout-actions";

function pane(id: string, tabIds: string[], extra: Partial<SplitPane> = {}): SplitNode {
  return { kind: "pane", pane: { id, tabIds, focusedTabId: tabIds[0] ?? null, ...extra } };
}

function row(id: string, children: SplitNode[], sizes?: number[]): SplitGroup {
  return {
    id,
    direction: "horizontal",
    children,
    sizes: sizes ?? children.map(() => 1 / children.length),
  };
}

const scope = "workspace" as const;

describe("resolveBoardKeyCommand", () => {
  it("serves every id the router can send to a board, after its translation", () => {
    // BOARD_ROUTED_ACTION_IDS are shortcut ids; the router delivers the dispatcher form.
    const dispatcherIdByRoutedId: Record<string, KeyboardActionDefinition> = {
      "workspace.arrange.single": { id: "workspace.arrange.single", scope },
      "workspace.arrange.columns2": { id: "workspace.arrange.columns2", scope },
      "workspace.arrange.columns3": { id: "workspace.arrange.columns3", scope },
      "workspace.arrange.grid": { id: "workspace.arrange.grid", scope },
      "workspace.arrange.watch": { id: "workspace.arrange.watch", scope },
      "workspace.arrange.restore": { id: "workspace.arrange.restore", scope },
      "workspace.arrange.equalize": { id: "workspace.arrange.equalize", scope },
      "workspace.pane.focus.left": { id: "workspace.pane.focus.left", scope },
      "workspace.pane.focus.right": { id: "workspace.pane.focus.right", scope },
      "workspace.pane.focus.up": { id: "workspace.pane.focus.up", scope },
      "workspace.pane.focus.down": { id: "workspace.pane.focus.down", scope },
      "workspace.tab.close.current": { id: "workspace.tab.close-current", scope },
      "workspace.tab.navigate.relative": { id: "workspace.tab.navigate-relative", scope, delta: 1 },
      "workspace.tab.navigate.index": { id: "workspace.tab.navigate-index", scope, index: 2 },
    };
    for (const id of BOARD_ROUTED_ACTION_IDS) {
      const action = dispatcherIdByRoutedId[id];
      expect(action, id).toBeDefined();
      expect(resolveBoardKeyCommand(action as KeyboardActionDefinition), id).not.toBeNull();
      expect(BOARD_HANDLED_ACTION_IDS as readonly string[], id).toContain(
        (action as KeyboardActionDefinition).id,
      );
    }
    expect(Object.keys(dispatcherIdByRoutedId)).toHaveLength(BOARD_ROUTED_ACTION_IDS.length);
  });

  it("maps presets, watch, restore, equalize, focus and close", () => {
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.columns2", scope })).toEqual({
      kind: "arrange",
      preset: "columns-2",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.grid", scope })).toEqual({
      kind: "arrange",
      preset: "grid",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.watch", scope })).toEqual({
      kind: "watch",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.restore", scope })).toEqual({
      kind: "restore",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.equalize", scope })).toEqual({
      kind: "equalize",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.pane.focus.up", scope })).toEqual({
      kind: "focus-pane",
      direction: "up",
    });
    expect(resolveBoardKeyCommand({ id: "workspace.tab.close-current", scope })).toEqual({
      kind: "close-tab",
    });
  });

  it("carries the tab navigation payloads", () => {
    expect(
      resolveBoardKeyCommand({ id: "workspace.tab.navigate-relative", scope, delta: -1 }),
    ).toEqual({ kind: "tab-relative", delta: -1 });
    expect(resolveBoardKeyCommand({ id: "workspace.tab.navigate-index", scope, index: 3 })).toEqual(
      { kind: "tab-index", index: 3 },
    );
  });

  it("ignores actions a board does not own", () => {
    expect(resolveBoardKeyCommand({ id: "workspace.terminal.new", scope })).toBeNull();
    expect(resolveBoardKeyCommand({ id: "workspace.arrange.menu", scope })).toBeNull();
  });
});

describe("board route and keys", () => {
  it("builds an encoded route", () => {
    expect(buildBoardRoute("live")).toBe("/boards/live");
    expect(buildBoardRoute("a b/c")).toBe("/boards/a%20b%2Fc");
  });

  it("keys a workspace by host and id", () => {
    expect(boardWorkspaceKey({ serverId: "s1", workspaceId: "w1" })).toBe("s1:w1");
  });
});

describe("resolveBoardViewport", () => {
  const windowSize = { width: 1200, height: 800 };
  it("prefers the measured area", () => {
    expect(resolveBoardViewport({ measured: { width: 900, height: 600 }, windowSize })).toEqual({
      width: 900,
      height: 600,
    });
  });
  it("falls back to the window before the first layout", () => {
    expect(resolveBoardViewport({ measured: null, windowSize })).toEqual(windowSize);
    expect(resolveBoardViewport({ measured: { width: 0, height: 0 }, windowSize })).toEqual(
      windowSize,
    );
  });
});

describe("group sizes and flex", () => {
  const children = [pane("a", ["t1"]), pane("b", ["t2"])];
  const group = row("g", children, [0.5, 0.5]);

  it("uses the board override only when it fits", () => {
    expect(resolveBoardGroupSizes(group, { g: [0.3, 0.7] })).toEqual([0.3, 0.7]);
    expect(resolveBoardGroupSizes(group, { g: [1] })).toEqual([0.5, 0.5]);
    expect(resolveBoardGroupSizes(group, undefined)).toEqual([0.5, 0.5]);
  });

  it("renormalizes over visible children", () => {
    expect(resolveBoardGroupFlex(children, [0.25, 0.75])).toEqual([0.25, 0.75]);
    const withHidden = [pane("a", ["t1"], { hidden: true }), pane("b", ["t2"])];
    expect(resolveBoardGroupFlex(withHidden, [0.5, 0.5])).toEqual([0, 1]);
  });

  it("gives every child zero when all are hidden", () => {
    const hidden = [pane("a", [], { hidden: true })];
    expect(resolveBoardGroupFlex(hidden, [1])).toEqual([0]);
  });
});

describe("panes and tabs", () => {
  const root: SplitNode = {
    kind: "group",
    group: row("g", [pane("left", ["t1", "t2"]), pane("right", ["t3"], { hidden: true })]),
  };

  it("finds a pane anywhere in the tree", () => {
    expect(findBoardPane(root, "right")?.id).toBe("right");
    expect(findBoardPane(root, "nope")).toBeNull();
    expect(findBoardPane(root, null)).toBeNull();
  });

  it("picks the focused tab when still open, else the first", () => {
    expect(resolvePaneActiveTabId({ id: "p", tabIds: ["a", "b"], focusedTabId: "b" })).toBe("b");
    expect(resolvePaneActiveTabId({ id: "p", tabIds: ["a", "b"], focusedTabId: "gone" })).toBe("a");
    expect(resolvePaneActiveTabId({ id: "p", tabIds: [], focusedTabId: null })).toBeNull();
    expect(resolvePaneActiveTabId(null)).toBeNull();
  });

  it("counts only tabs in visible panes", () => {
    expect(countVisibleBoardTabs(root)).toBe(2);
  });

  it("finds the neighbour pane", () => {
    const twoPanes: SplitNode = {
      kind: "group",
      group: row("g", [pane("left", ["t1"]), pane("right", ["t2"])]),
    };
    expect(resolveAdjacentBoardPaneId(twoPanes, "left", "right")).toBe("right");
    expect(resolveAdjacentBoardPaneId(twoPanes, "left", "left")).toBeNull();
    expect(resolveAdjacentBoardPaneId(twoPanes, null, "right")).toBeNull();
  });
});

describe("tab navigation inside a pane", () => {
  const ids = ["a", "b", "c"];

  it("walks next and previous with wrap", () => {
    expect(resolveRelativeTabId(ids, "a", 1)).toBe("b");
    expect(resolveRelativeTabId(ids, "c", 1)).toBe("a");
    expect(resolveRelativeTabId(ids, "a", -1)).toBe("c");
  });

  it("treats a missing active tab as the first", () => {
    expect(resolveRelativeTabId(ids, null, 1)).toBe("b");
    expect(resolveRelativeTabId(ids, "gone", -1)).toBe("c");
    expect(resolveRelativeTabId([], "a", 1)).toBeNull();
  });

  it("picks the nth tab, 1-based", () => {
    expect(resolveIndexedTabId(ids, 1)).toBe("a");
    expect(resolveIndexedTabId(ids, 3)).toBe("c");
    expect(resolveIndexedTabId(ids, 4)).toBeNull();
  });

  it("drops tabs that have no origin", () => {
    const origins: Record<string, BoardTabOrigin> = {
      a: { serverId: "s", workspaceId: "w", agentId: "1" },
      c: { serverId: "s", workspaceId: "w", agentId: "3" },
    };
    const target: SplitPane = { id: "p", tabIds: ["a", "b", "c"], focusedTabId: "a" };
    expect(resolveRenderableTabIds(target, origins)).toEqual(["a", "c"]);
    expect(resolveRenderableTabIds(null, origins)).toEqual([]);
  });
});

describe("recent-tabs switcher scope", () => {
  it("moves a used tab to the front and keeps one entry per tab", () => {
    expect(recordBoardTabUse(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(recordBoardTabUse(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    const same = ["a", "b"];
    expect(recordBoardTabUse(same, "a")).toBe(same);
    expect(recordBoardTabUse(["a", "b", "c"], "d", 2)).toEqual(["d", "a"]);
  });

  it("puts the tab on screen first, then the rest by recent use", () => {
    expect(
      orderBoardSwitcherTabIds({
        tabIds: ["a", "b", "c", "d"],
        activeTabId: "c",
        mru: ["c", "d", "a"],
        limit: 10,
      }),
    ).toEqual(["c", "d", "a", "b"]);
  });

  it("ignores history for tabs that left the pane and tabs it never saw", () => {
    expect(
      orderBoardSwitcherTabIds({
        tabIds: ["a", "b"],
        activeTabId: "b",
        mru: ["gone", "a"],
        limit: 10,
      }),
    ).toEqual(["b", "a"]);
  });

  it("falls back to strip order and honours the limit", () => {
    expect(
      orderBoardSwitcherTabIds({
        tabIds: ["a", "b", "c"],
        activeTabId: null,
        mru: [],
        limit: 2,
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("groupBoardVisibleAgents", () => {
  const origins: Record<string, BoardTabOrigin> = {
    a1: { serverId: "s2", workspaceId: "w1", agentId: "agent-b" },
    a2: { serverId: "s2", workspaceId: "w1", agentId: "agent-a" },
    b1: { serverId: "s1", workspaceId: "w2", agentId: "agent-c" },
    f1: { serverId: "s1", workspaceId: "w2", path: "src/x.ts" },
  };

  it("takes the active tab of every pane, grouped by host, sorted", () => {
    const root: SplitNode = {
      kind: "group",
      group: row("g", [pane("p1", ["a1", "a2"]), pane("p2", ["b1"]), pane("p3", ["a2"])]),
    };
    expect(groupBoardVisibleAgents(root, origins)).toEqual([
      { serverId: "s1", agentIds: ["agent-c"] },
      { serverId: "s2", agentIds: ["agent-a", "agent-b"] },
    ]);
  });

  it("uses the selected tab, not the first, and skips file tabs and hidden panes", () => {
    const root: SplitNode = {
      kind: "group",
      group: row("g", [
        pane("p1", ["a1", "a2"], { focusedTabId: "a2" }),
        pane("p2", ["b1", "f1"], { focusedTabId: "f1" }),
        pane("p3", ["b1"], { hidden: true }),
      ]),
    };
    expect(groupBoardVisibleAgents(root, origins)).toEqual([
      { serverId: "s2", agentIds: ["agent-a"] },
    ]);
  });

  it("ignores tabs without an origin and empty boards", () => {
    expect(groupBoardVisibleAgents(pane("p", ["nope"]), origins)).toEqual([]);
    expect(groupBoardVisibleAgents(pane("p", []), origins)).toEqual([]);
  });
});

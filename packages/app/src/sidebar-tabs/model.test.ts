import { describe, expect, it } from "vitest";
import type { BoardTabOrigin } from "@/boards/types";
import {
  boardSidebarTabsKey,
  listBoardPaneLines,
  listWorkspaceTabLines,
} from "@/sidebar-tabs/model";
import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";

function tab(tabId: string, target: WorkspaceTab["target"]): WorkspaceTab {
  return { tabId, target, createdAt: 1 };
}

const A = tab("agent_a", { kind: "agent", agentId: "a" });
const B = tab("agent_b", { kind: "agent", agentId: "b" });
const FILE = tab("file_x", { kind: "file", path: "/repo/x.ts" });
const TERM = tab("terminal_t", { kind: "terminal", terminalId: "t" });

/** Panes keep their tabs inline, as the layout store does; `tabIds` carries the order. */
function pane(id: string, tabs: WorkspaceTab[], focusedTabId: string | null, hidden = false) {
  return {
    kind: "pane",
    pane: {
      id,
      tabIds: tabs.map((t) => t.tabId),
      focusedTabId,
      tabs,
      ...(hidden ? { hidden } : {}),
    },
  } as unknown as SplitNode;
}

function group(...children: SplitNode[]): SplitNode {
  return {
    kind: "group",
    group: {
      id: "g",
      direction: "horizontal",
      sizes: children.map(() => 1 / children.length),
      children,
    },
  };
}

describe("listWorkspaceTabLines", () => {
  it("lists a single pane's tabs in the order of its tab bar and marks the focused tab", () => {
    const layout: WorkspaceLayout = {
      root: pane("main", [FILE, A, TERM], "agent_a"),
      focusedPaneId: "main",
    };
    const lines = listWorkspaceTabLines({ layout });
    expect(lines.map((line) => line.tabId)).toEqual(["file_x", "agent_a", "terminal_t"]);
    expect(lines.map((line) => line.active)).toEqual([false, true, false]);
    expect(lines.every((line) => line.paneId === "main")).toBe(true);
  });

  it("lists split panes in tree order, highlighting only the focused pane's tab", () => {
    const layout: WorkspaceLayout = {
      root: group(pane("left", [A, B], "agent_b"), pane("right", [TERM], "terminal_t")),
      focusedPaneId: "right",
    };
    const lines = listWorkspaceTabLines({ layout });
    expect(lines.map((line) => [line.paneId, line.tabId, line.active])).toEqual([
      ["left", "agent_a", false],
      ["left", "agent_b", false],
      ["right", "terminal_t", true],
    ]);
  });

  it("leaves out the Explorer sidebar's pane and a hidden pane", () => {
    const layout: WorkspaceLayout = {
      root: group(
        pane("main", [A], "agent_a"),
        pane("explorer", [FILE], "file_x"),
        pane("gone", [B], "agent_b", true),
      ),
      focusedPaneId: "main",
    };
    expect(
      listWorkspaceTabLines({ layout, excludePaneId: "explorer" }).map((line) => line.tabId),
    ).toEqual(["agent_a"]);
  });

  it("falls back to the first listed pane when focus sits on an unlisted one", () => {
    const layout: WorkspaceLayout = {
      root: group(pane("main", [A], "agent_a"), pane("explorer", [FILE], "file_x")),
      focusedPaneId: "explorer",
    };
    const lines = listWorkspaceTabLines({ layout, excludePaneId: "explorer" });
    expect(lines.map((line) => [line.tabId, line.active])).toEqual([["agent_a", true]]);
  });

  it("is empty without a layout", () => {
    expect(listWorkspaceTabLines({ layout: null })).toEqual([]);
  });
});

describe("listBoardPaneLines", () => {
  const origin = (agentId: string, workspaceId: string): BoardTabOrigin => ({
    serverId: "s1",
    workspaceId,
    agentId,
  });

  it("gives one line per visible pane, with that pane's active tab and where it lives", () => {
    const layout: WorkspaceLayout = {
      root: group(
        pane("p1", [A, B], "agent_b"),
        pane("p2", [], null),
        pane("p3", [TERM], null, true),
      ),
      focusedPaneId: "p1",
    };
    const lines = listBoardPaneLines({
      layout,
      origins: { agent_a: origin("a", "w1"), agent_b: origin("b", "w2") },
    });
    expect(lines.map((line) => line.paneId)).toEqual(["p1", "p2"]);
    expect(lines[0]?.descriptor?.tabId).toBe("agent_b");
    expect(lines[0]?.origin).toEqual(origin("b", "w2"));
    expect(lines[0]?.active).toBe(true);
    // An empty pane still has a line, so it can be focused.
    expect(lines[1]).toMatchObject({ paneId: "p2", descriptor: null, origin: null, active: false });
  });

  it("falls back to a pane's first tab when its focused tab is gone", () => {
    const layout: WorkspaceLayout = {
      root: pane("p1", [A, B], "agent_missing"),
      focusedPaneId: "p1",
    };
    const [line] = listBoardPaneLines({ layout, origins: { agent_a: origin("a", "w1") } });
    expect(line?.descriptor?.tabId).toBe("agent_a");
  });

  it("marks the first pane active when focus points at a pane that is not shown", () => {
    const layout: WorkspaceLayout = {
      root: group(pane("p1", [A], "agent_a"), pane("p2", [B], "agent_b")),
      focusedPaneId: "ghost",
    };
    const lines = listBoardPaneLines({
      layout,
      origins: { agent_a: origin("a", "w1"), agent_b: origin("b", "w1") },
    });
    expect(lines.map((line) => line.active)).toEqual([true, false]);
  });
});

describe("boardSidebarTabsKey", () => {
  it("keeps a view's key apart from every workspace key", () => {
    expect(boardSidebarTabsKey("board_1")).toBe("board:board_1");
  });
});

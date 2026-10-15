import { describe, expect, it } from "vitest";
import {
  boardRowKey,
  cycleWorkspaceIndex,
  boardVisit,
  orderSwitcherKeys,
  initialWorkspaceSelectionIndex,
  mergeWorkspaceOrder,
  pruneWorkspaceHistory,
  pruneWorkspaceRows,
  recordWorkspaceVisit,
  workspaceVisitKey,
  type WorkspaceSwitcherVisit,
} from "@/workspace-switcher/model";

function visit(workspaceId: string, serverId = "srv", at = 1): WorkspaceSwitcherVisit {
  return { serverId, workspaceId, at };
}

describe("workspace switcher model", () => {
  it("moves a revisited workspace to the front", () => {
    expect(recordWorkspaceVisit([visit("a"), visit("b")], visit("b", "srv", 3))).toEqual([
      visit("b", "srv", 3),
      visit("a"),
    ]);
  });

  it("keeps identical workspace ids on different hosts distinct", () => {
    expect(workspaceVisitKey(visit("same", "one"))).not.toBe(
      workspaceVisitKey(visit("same", "two")),
    );
  });

  it("backfills unvisited workspaces without duplicating history", () => {
    expect(mergeWorkspaceOrder(["srv:a", "srv:b"], ["srv:b", "srv:c"])).toEqual([
      "srv:a",
      "srv:b",
      "srv:c",
    ]);
  });

  it("wraps in either direction", () => {
    expect(cycleWorkspaceIndex(2, 1, 3)).toBe(0);
    expect(cycleWorkspaceIndex(0, -1, 3)).toBe(2);
  });

  it("starts on row 0 when off a workspace route, row 1 when on one", () => {
    expect(initialWorkspaceSelectionIndex({ length: 3, rowZeroIsCurrent: false })).toBe(0);
    expect(initialWorkspaceSelectionIndex({ length: 3, rowZeroIsCurrent: true })).toBe(1);
  });

  it("handles a single-row list", () => {
    expect(initialWorkspaceSelectionIndex({ length: 1, rowZeroIsCurrent: false })).toBe(0);
    expect(initialWorkspaceSelectionIndex({ length: 1, rowZeroIsCurrent: true })).toBeNull();
    expect(initialWorkspaceSelectionIndex({ length: 0, rowZeroIsCurrent: false })).toBeNull();
  });

  it("drops rows whose workspace is gone and keeps the array when none are", () => {
    const rows = [visit("a"), visit("b"), visit("c")];
    expect(pruneWorkspaceRows(rows, new Set(["srv:a", "srv:c"]))).toEqual([visit("a"), visit("c")]);
    expect(pruneWorkspaceRows(rows, new Set(["srv:a", "srv:b", "srv:c"]))).toBe(rows);
  });

  it("keeps history while the live set is empty and drops missing ids otherwise", () => {
    const history = [visit("a"), visit("b"), visit("x", "other")];
    expect(pruneWorkspaceHistory(history, new Set())).toBe(history);
    expect(pruneWorkspaceHistory(history, new Set(["srv:a"]))).toEqual([
      visit("a"),
      visit("x", "other"),
    ]);
    expect(pruneWorkspaceHistory(history, new Set(["srv:a"]), "srv:b")).toEqual([
      visit("a"),
      visit("b"),
      visit("x", "other"),
    ]);
  });
});

describe("views in the switcher order", () => {
  const desk = new Set(["srv:w3", "srv:w4"]);
  const order = (input: Partial<Parameters<typeof orderSwitcherKeys>[0]>) =>
    orderSwitcherKeys({
      currentKey: "srv:w1",
      historyKeys: [],
      workspaceKeys: ["srv:w1", "srv:w2", "srv:w3", "srv:w4", "srv:w5"],
      boardKeys: ["board:live", "board:b1"],
      deskKeys: desk,
      ...input,
    });

  it("keys a view under a pseudo host so it can never collide with a workspace", () => {
    expect(boardRowKey("live")).toBe("board:live");
    expect(boardVisit("live")).toEqual({ serverId: "board", workspaceId: "live" });
    expect(workspaceVisitKey(boardVisit("live"))).toBe(boardRowKey("live"));
  });

  it("makes a tap from a view land on the workspace you were on before it", () => {
    // visited w2, then the view; now on the view.
    expect(
      order({ currentKey: "board:b1", historyKeys: ["board:b1", "srv:w2", "srv:w1"] }).slice(0, 2),
    ).toEqual(["board:b1", "srv:w2"]);
  });

  it("makes a tap from a workspace land on the view you were on before it", () => {
    expect(
      order({ currentKey: "srv:w2", historyKeys: ["srv:w2", "board:b1", "srv:w1"] }).slice(0, 2),
    ).toEqual(["srv:w2", "board:b1"]);
  });

  it("orders visited views and workspaces together by recency after the head", () => {
    expect(
      order({
        currentKey: "srv:w1",
        historyKeys: ["srv:w1", "srv:w2", "board:b1", "srv:w3", "board:live"],
      }),
    ).toEqual(["srv:w1", "srv:w2", "board:b1", "srv:w3", "board:live", "srv:w4", "srv:w5"]);
  });

  it("puts never-visited views after the Desk and visited views, ahead of the rest", () => {
    expect(order({})).toEqual([
      "srv:w1",
      "srv:w2",
      "srv:w3",
      "srv:w4",
      "board:live",
      "board:b1",
      "srv:w5",
    ]);
  });

  it("works off a workspace route, where the head is a single row", () => {
    expect(
      order({ currentKey: null, historyKeys: ["board:b1", "srv:w1"], boardKeys: ["board:b1"] }),
    ).toEqual(["board:b1", "srv:w3", "srv:w4", "srv:w1", "srv:w2", "srv:w5"]);
  });

  it("still offers a never-visited view when it is the only other place", () => {
    expect(
      order({ workspaceKeys: ["srv:w1"], boardKeys: ["board:live"], historyKeys: ["srv:w1"] }),
    ).toEqual(["srv:w1", "board:live"]);
  });

  it("prunes the visit of a deleted view and keeps the current one", () => {
    const history = [
      { serverId: "board", workspaceId: "gone", at: 3 },
      { serverId: "board", workspaceId: "kept", at: 2 },
      visit("a", "srv", 1),
    ];
    const live = new Set(["board:kept", "srv:a"]);
    expect(pruneWorkspaceHistory(history, live).map((v) => v.workspaceId)).toEqual(["kept", "a"]);
    expect(pruneWorkspaceHistory(history, live, "board:gone").map((v) => v.workspaceId)).toEqual([
      "gone",
      "kept",
      "a",
    ]);
  });
});

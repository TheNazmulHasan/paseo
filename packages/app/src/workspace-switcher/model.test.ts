import { describe, expect, it } from "vitest";
import {
  cycleWorkspaceIndex,
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

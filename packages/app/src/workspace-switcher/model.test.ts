import { describe, expect, it } from "vitest";
import {
  cycleWorkspaceIndex,
  mergeWorkspaceOrder,
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
});

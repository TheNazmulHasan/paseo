import { describe, expect, it } from "vitest";
import { resolveDeskTargetView } from "@/desk/target-view";
import type { BoardSummary } from "@/boards/types";

const live: BoardSummary = { id: "live", name: "Live", kind: "live", sessionCount: 3 };
const a: BoardSummary = { id: "board_a", name: "A | B", kind: "user", sessionCount: 4 };
const b: BoardSummary = { id: "board_b", name: "C | D", kind: "user", sessionCount: 2 };

describe("resolveDeskTargetView", () => {
  it("takes the most recently visited saved view, skipping workspaces and Live", () => {
    const history = [
      { serverId: "srv", workspaceId: "w1" },
      { serverId: "board", workspaceId: "live" },
      { serverId: "board", workspaceId: "board_b" },
      { serverId: "board", workspaceId: "board_a" },
    ];
    expect(resolveDeskTargetView(history, [live, a, b])?.id).toBe("board_b");
  });

  it("skips a visited view that was deleted", () => {
    const history = [
      { serverId: "board", workspaceId: "board_gone" },
      { serverId: "board", workspaceId: "board_a" },
    ];
    expect(resolveDeskTargetView(history, [live, a])?.id).toBe("board_a");
  });

  it("has no target before any saved view was visited", () => {
    expect(resolveDeskTargetView([{ serverId: "srv", workspaceId: "w1" }], [live, a])).toBeNull();
  });
});

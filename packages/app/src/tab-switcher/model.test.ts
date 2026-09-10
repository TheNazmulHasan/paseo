import { describe, expect, it } from "vitest";
import {
  cycleIndex,
  mergeRecentOrder,
  pruneVisits,
  recordVisit,
  type TabSwitcherVisit,
} from "@/tab-switcher/model";

function visit(agentId: string, at = 1): TabSwitcherVisit {
  return { serverId: "srv", agentId, at };
}

describe("recordVisit", () => {
  it("moves the visited chat to the front and drops its older entry", () => {
    const history = [visit("a"), visit("b"), visit("c")];
    expect(recordVisit(history, visit("c", 9)).map((entry) => entry.agentId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("returns the same array when the chat is already on top", () => {
    // Re-rendering the workspace must not churn the store, or every subscriber
    // re-renders on each keystroke in the composer.
    const history = [visit("a"), visit("b")];
    expect(recordVisit(history, visit("a", 9))).toBe(history);
  });

  it("keeps the two servers' identically-named agents apart", () => {
    const history = [{ serverId: "other", agentId: "a", at: 1 }];
    const next = recordVisit(history, visit("a", 2));
    expect(next).toHaveLength(2);
  });

  it("caps the history at the limit", () => {
    const history = [visit("a"), visit("b"), visit("c")];
    expect(recordVisit(history, visit("d", 4), 2)).toHaveLength(2);
  });

  it("ignores a blank identifier", () => {
    const history = [visit("a")];
    expect(recordVisit(history, { serverId: "srv", agentId: "  ", at: 2 })).toBe(history);
  });
});

describe("pruneVisits", () => {
  it("drops chats that no longer exist and keeps the array when all survive", () => {
    const history = [visit("a"), visit("b")];
    expect(pruneVisits(history, (entry) => entry.agentId !== "b")).toEqual([visit("a")]);
    expect(pruneVisits(history, () => true)).toBe(history);
  });
});

describe("cycleIndex", () => {
  it("wraps in both directions", () => {
    expect(cycleIndex(0, 1, 3)).toBe(1);
    expect(cycleIndex(2, 1, 3)).toBe(0);
    expect(cycleIndex(0, -1, 3)).toBe(2);
  });

  it("stays at 0 for an empty list", () => {
    expect(cycleIndex(0, 1, 0)).toBe(0);
  });
});

describe("mergeRecentOrder", () => {
  it("keeps visit order first and backfills the rest", () => {
    expect(mergeRecentOrder(["b", "a"], ["a", "c", "d"], 10)).toEqual(["b", "a", "c", "d"]);
  });

  it("fills the list on a fresh install, when nothing has been visited yet", () => {
    // The bug this exists for: an empty history left one candidate, so the
    // switcher refused to open and the key looked dead.
    expect(mergeRecentOrder([], ["a", "b", "c"], 10)).toEqual(["a", "b", "c"]);
  });

  it("never repeats a chat and respects the limit", () => {
    expect(mergeRecentOrder(["a", "a"], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

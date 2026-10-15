import { describe, expect, it } from "vitest";
import { migrateTabSwitcherState } from "@/tab-switcher/mru-store";

describe("migrateTabSwitcherState", () => {
  it("tags v1 history as agent visits instead of discarding it", () => {
    // v1 predates file tabs, so every stored entry was a chat and carries no
    // `kind`. Dropping them would silently reset a recent list he relies on.
    const migrated = migrateTabSwitcherState({
      history: [{ serverId: "srv", agentId: "a", at: 5 }],
    });
    expect(migrated.history).toEqual([{ kind: "agent", serverId: "srv", agentId: "a", at: 5 }]);
  });

  it("passes v2 entries through untouched", () => {
    const history = [
      { kind: "agent", serverId: "srv", agentId: "a", at: 1 },
      { kind: "file", serverId: "srv", workspaceId: "wks", path: "notes.md", at: 2 },
    ];
    expect(migrateTabSwitcherState({ history }).history).toEqual(history);
  });

  it("returns an empty history rather than throwing on junk", () => {
    expect(migrateTabSwitcherState({ history: "nonsense" }).history).toEqual([]);
    expect(migrateTabSwitcherState(null).history).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createUndoLedger, planClose, runBatch, UNDO_WINDOW_MS } from "./close-actions";

describe("planClose", () => {
  it("lists each session once, in order, as host + raw agent id", () => {
    const plan = planClose([
      { serverId: "s1", agentId: "a" },
      { serverId: "s2", agentId: "a" },
      { serverId: "s1", agentId: "a" },
      { serverId: "s1", agentId: "b" },
    ]);
    expect(plan).toEqual([
      { serverId: "s1", agentId: "a" },
      { serverId: "s2", agentId: "a" },
      { serverId: "s1", agentId: "b" },
    ]);
  });

  it("drops any extra fields of the session it was given", () => {
    const [target] = planClose([{ serverId: "s1", agentId: "a", title: "x" } as never]);
    expect(Object.keys(target).sort()).toEqual(["agentId", "serverId"]);
  });

  it("an empty batch is empty", () => {
    expect(planClose([])).toEqual([]);
  });
});

describe("runBatch", () => {
  const targets = [
    { serverId: "s1", agentId: "a" },
    { serverId: "s1", agentId: "b" },
    { serverId: "s1", agentId: "c" },
  ];

  it("runs the action on every target", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const result = await runBatch(targets, action);
    expect(action).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ done: targets, failed: [] });
  });

  it("one failure does not stop the rest and is reported", async () => {
    const action = vi.fn(async (target: { agentId: string }) => {
      if (target.agentId === "b") throw new Error("host gone");
    });
    const result = await runBatch(targets, action);
    expect(result.done.map((t) => t.agentId)).toEqual(["a", "c"]);
    expect(result.failed.map((t) => t.agentId)).toEqual(["b"]);
  });
});

describe("createUndoLedger", () => {
  const a = { serverId: "s1", agentId: "a" };
  const b = { serverId: "s1", agentId: "b" };

  it("Undo restores what was just closed", () => {
    const ledger = createUndoLedger();
    expect(ledger.record([a], 1_000)).toEqual([a]);
    expect(ledger.take(2_000)).toEqual([a]);
    expect(ledger.take(2_000)).toEqual([]);
  });

  it("a second close inside the window is undone together with the first (one toast at a time)", () => {
    const ledger = createUndoLedger();
    ledger.record([a], 1_000);
    expect(ledger.record([b], 5_000)).toEqual([a, b]);
    expect(ledger.take(6_000)).toEqual([a, b]);
  });

  it("the batch is undone as one: Close them then Undo brings back all of them", () => {
    const ledger = createUndoLedger();
    ledger.record([a, b], 0);
    expect(ledger.take(UNDO_WINDOW_MS - 1)).toEqual([a, b]);
  });

  it("an entry older than the window can no longer be undone, a newer one still can", () => {
    const ledger = createUndoLedger();
    ledger.record([a], 0);
    expect(ledger.record([b], UNDO_WINDOW_MS + 1)).toEqual([b]);
    expect(ledger.take(UNDO_WINDOW_MS + 2)).toEqual([b]);
  });

  it("after the window nothing is left to take", () => {
    const ledger = createUndoLedger();
    ledger.record([a], 0);
    expect(ledger.take(UNDO_WINDOW_MS)).toEqual([]);
  });
});

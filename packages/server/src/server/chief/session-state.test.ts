import { describe, expect, it } from "vitest";

import { deriveSessionState, selectSessionStates, type SessionState } from "./session-state.js";

describe("deriveSessionState", () => {
  it("needs_you for a pending permission, whatever the status", () => {
    expect(deriveSessionState({ status: "running", pendingPermissionCount: 1 })).toBe("needs_you");
    expect(deriveSessionState({ status: "idle", pendingPermissionCount: 2 })).toBe("needs_you");
  });

  it("needs_you for attention on a permission or an error, and for the error status", () => {
    expect(
      deriveSessionState({ status: "idle", requiresAttention: true, attentionReason: "permission" }),
    ).toBe("needs_you");
    expect(
      deriveSessionState({ status: "idle", requiresAttention: true, attentionReason: "error" }),
    ).toBe("needs_you");
    expect(deriveSessionState({ status: "error" })).toBe("needs_you");
  });

  it("working while running or initializing", () => {
    expect(deriveSessionState({ status: "running" })).toBe("working");
    expect(deriveSessionState({ status: "initializing" })).toBe("working");
  });

  it("your_move only for an unseen finished turn (requiresAttention, reason finished)", () => {
    expect(
      deriveSessionState({ status: "idle", requiresAttention: true, attentionReason: "finished" }),
    ).toBe("your_move");
    // A closed agent whose last turn the user never opened is still waiting on him.
    expect(
      deriveSessionState({ status: "closed", requiresAttention: true, attentionReason: "finished" }),
    ).toBe("your_move");
  });

  it("parked for an idle agent the user has already seen", () => {
    expect(deriveSessionState({ status: "idle" })).toBe("parked");
    expect(deriveSessionState({ status: "closed", requiresAttention: false })).toBe("parked");
    expect(deriveSessionState({ status: "idle", requiresAttention: false, attentionReason: "finished" })).toBe(
      "parked",
    );
  });

  it("does not read message timestamps: the agent speaking last is not a move for the user", () => {
    // The old rule (lastResponseAt > lastUserMessageAt) is gone; the input has no such field.
    expect(deriveSessionState({ status: "idle", requiresAttention: false })).toBe("parked");
  });

  it("running beats an old unread finish; needs_you beats running", () => {
    expect(
      deriveSessionState({ status: "running", requiresAttention: true, attentionReason: "finished" }),
    ).toBe("working");
    expect(
      deriveSessionState({ status: "running", requiresAttention: true, attentionReason: "permission" }),
    ).toBe("needs_you");
  });
});

interface Row {
  id: string;
  state: SessionState;
  workspaceId: string | null;
  folderId: string | null;
  folder: string | null;
  lastActivityAt: string | null;
}

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function row(id: string, state: SessionState, extra: Partial<Row> = {}): Row {
  return {
    id,
    state,
    workspaceId: "wks_a",
    folderId: null,
    folder: null,
    lastActivityAt: daysAgo(1),
    ...extra,
  };
}

describe("selectSessionStates", () => {
  const rows: Row[] = [
    row("parked-old", "parked", { lastActivityAt: daysAgo(30) }),
    row("move-new", "your_move", { lastActivityAt: daysAgo(0.5) }),
    row("working", "working", { lastActivityAt: daysAgo(0.1) }),
    row("needs", "needs_you", { lastActivityAt: daysAgo(5) }),
    row("move-old", "your_move", { lastActivityAt: daysAgo(3) }),
    row("parked-new", "parked", { lastActivityAt: daysAgo(2), workspaceId: "wks_b" }),
  ];

  it("sorts needs_you, working, your_move, parked; most recent first inside each", () => {
    expect(selectSessionStates(rows, { now: NOW }).map((r) => r.id)).toEqual([
      "needs",
      "working",
      "move-new",
      "move-old",
      "parked-new",
      "parked-old",
    ]);
  });

  it("filters by state", () => {
    expect(selectSessionStates(rows, { state: ["your_move", "needs_you"], now: NOW }).map((r) => r.id)).toEqual([
      "needs",
      "move-new",
      "move-old",
    ]);
  });

  it("filters by workspace", () => {
    expect(selectSessionStates(rows, { workspaceId: "wks_b", now: NOW }).map((r) => r.id)).toEqual([
      "parked-new",
    ]);
  });

  it("filters by folder name or id, any case, and 'unfiled'", () => {
    const filed = [
      row("a", "parked", { folderId: "fld_1", folder: "Faith" }),
      row("b", "parked", { folderId: "fld_2", folder: "Clients" }),
      row("c", "parked"),
    ];
    expect(selectSessionStates(filed, { folder: "faith" }).map((r) => r.id)).toEqual(["a"]);
    expect(selectSessionStates(filed, { folder: "FLD_2" }).map((r) => r.id)).toEqual(["b"]);
    expect(selectSessionStates(filed, { folder: "Unfiled" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("staleDays keeps sessions idle for at least that many days", () => {
    expect(selectSessionStates(rows, { staleDays: 14, now: NOW }).map((r) => r.id)).toEqual([
      "parked-old",
    ]);
    expect(selectSessionStates(rows, { staleDays: 3, now: NOW }).map((r) => r.id)).toEqual([
      "needs",
      "move-old",
      "parked-old",
    ]);
  });

  it("limits after sorting", () => {
    expect(selectSessionStates(rows, { limit: 2, now: NOW }).map((r) => r.id)).toEqual([
      "needs",
      "working",
    ]);
  });

  it("combines filters and keeps input order on ties", () => {
    const tied = [
      row("x", "parked", { lastActivityAt: daysAgo(4) }),
      row("y", "parked", { lastActivityAt: daysAgo(4) }),
    ];
    expect(selectSessionStates(tied, { state: ["parked"], staleDays: 1, now: NOW }).map((r) => r.id)).toEqual([
      "x",
      "y",
    ]);
  });
});

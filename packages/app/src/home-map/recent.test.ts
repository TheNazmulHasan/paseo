import { describe, expect, it } from "vitest";
import { closedBelowOpen, closedNeeded, pageRecent, type ClosedRecent } from "./recent";
import type { HomeSessionEntry } from "./view-model";

const open = (id: string) => ({ session: { id } }) as unknown as HomeSessionEntry;
const closed = (agentId: string, at: string, serverId = "s1"): ClosedRecent => ({
  serverId,
  agentId,
  title: agentId,
  workspaceId: "w",
  place: null,
  lastUserMessageAt: at,
  lastActivityAt: at,
  archivedAt: at,
});

describe("pageRecent", () => {
  const opens = Array.from({ length: 12 }, (_, i) => open(`s1:o${i}`));

  it("shows the first 10 open sessions, then offers more", () => {
    const page = pageRecent({ open: opens, closed: [], visible: 10, moreOnDaemon: false });
    expect(page.rows).toHaveLength(10);
    expect(page.canShowMore).toBe(true);
  });

  it("Show 10 more adds 10 and keeps going into closed sessions once open ones run out", () => {
    const old = [
      closed("c1", "2026-11-10T00:00:00Z"),
      closed("c2", "2026-11-12T00:00:00Z"),
    ];
    const page = pageRecent({ open: opens, closed: old, visible: 20, moreOnDaemon: false });
    expect(page.rows.map((r) => r.kind)).toEqual([...Array(12).fill("open"), "closed", "closed"]);
    const closedRows = page.rows.filter((r) => r.kind === "closed").map((r) => r.key);
    expect(closedRows).toEqual(["s1:c2", "s1:c1"]);
    expect(page.canShowMore).toBe(false);
  });

  it("keeps offering more while a daemon has closed sessions it has not sent", () => {
    const page = pageRecent({ open: [], closed: [closed("c1", "2026-11-10T00:00:00Z")], visible: 10, moreOnDaemon: true });
    expect(page.canShowMore).toBe(true);
  });

  it("a closed session that is open again is not listed twice", () => {
    const rows = closedBelowOpen([closed("o0", "2026-11-10T00:00:00Z")], new Set(["s1:o0"]));
    expect(rows).toEqual([]);
  });

  it("merges closed sessions of two hosts newest first", () => {
    const rows = closedBelowOpen(
      [closed("a", "2026-11-01T00:00:00Z", "s1"), closed("b", "2026-11-05T00:00:00Z", "s2")],
      new Set(),
    );
    expect(rows.map((r) => r.agentId)).toEqual(["b", "a"]);
  });
});

describe("closedNeeded", () => {
  it("asks only for what the visible rows still lack", () => {
    expect(closedNeeded({ visible: 10, openCount: 4, closedLoaded: 0 })).toBe(6);
    expect(closedNeeded({ visible: 10, openCount: 4, closedLoaded: 6 })).toBe(0);
    expect(closedNeeded({ visible: 10, openCount: 30, closedLoaded: 0 })).toBe(0);
  });
});

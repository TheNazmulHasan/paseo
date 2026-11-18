import { describe, expect, it } from "vitest";
import type { HomeBrief, HomeSnapshot, HomeState } from "@getpaseo/protocol/home";
import { hostsWithLayout, localDayKey, mergeHomeSnapshots, resolveClosedToday } from "./snapshots";

function brief(over: Partial<HomeBrief> = {}): HomeBrief {
  return {
    headline: "A headline",
    since: null,
    queue: [],
    checkOn: [],
    superseded: [],
    generatedAt: "2026-11-18T08:00:00.000Z",
    ...over,
  };
}

function snapshot(
  over: Omit<Partial<HomeSnapshot>, "state"> & { state?: Partial<HomeState> } = {},
): HomeSnapshot {
  const { state, ...rest } = over;
  return {
    brief: null,
    closedToday: 0,
    briefRunning: false,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...rest,
    state: { snoozed: {}, kept: {}, chiefLayout: null, ...state },
  };
}

describe("mergeHomeSnapshots", () => {
  it("with no host answered: no brief, an empty state and no closed-today count", () => {
    const merged = mergeHomeSnapshots({}, {});
    expect(merged.brief).toBeNull();
    expect(merged.closedToday).toBeNull();
    expect(merged.hostCount).toBe(0);
    expect(merged.state).toEqual({ snoozed: {}, kept: {}, chiefLayout: null });
  });

  it("one host passes through unchanged", () => {
    const b = brief({ queue: [{ id: "a", group: "now" }], checkOn: ["c"], superseded: ["s"] });
    const merged = mergeHomeSnapshots({ s1: snapshot({ brief: b, closedToday: 4 }) }, { s1: 10 });
    expect(merged.brief).toEqual(b);
    expect(merged.closedToday).toBe(4);
    expect(merged.hostCount).toBe(1);
  });

  it("takes headline and since from the host with the most open sessions", () => {
    const merged = mergeHomeSnapshots(
      {
        small: snapshot({ brief: brief({ headline: "Small", since: "small since" }) }),
        big: snapshot({ brief: brief({ headline: "Big", since: "big since" }) }),
      },
      { small: 2, big: 30 },
    );
    expect(merged.brief?.headline).toBe("Big");
    expect(merged.brief?.since).toBe("big since");
  });

  it("breaks a tie on the newer brief, then on the server id", () => {
    const newer = mergeHomeSnapshots(
      {
        a: snapshot({ brief: brief({ headline: "A", generatedAt: "2026-11-18T08:00:00.000Z" }) }),
        b: snapshot({ brief: brief({ headline: "B", generatedAt: "2026-11-18T09:00:00.000Z" }) }),
      },
      { a: 5, b: 5 },
    );
    expect(newer.brief?.headline).toBe("B");
    const sameTime = mergeHomeSnapshots(
      {
        z: snapshot({ brief: brief({ headline: "Z" }) }),
        a: snapshot({ brief: brief({ headline: "A" }) }),
      },
      { z: 5, a: 5 },
    );
    expect(sameTime.brief?.headline).toBe("A");
  });

  it("concatenates queue, checkOn and superseded with the primary host first", () => {
    const merged = mergeHomeSnapshots(
      {
        s1: snapshot({
          brief: brief({
            queue: [{ id: "a1", group: "now" }],
            checkOn: ["c1"],
            superseded: ["x1"],
          }),
        }),
        s2: snapshot({
          brief: brief({
            queue: [{ id: "b1", group: "today" }],
            checkOn: ["c2"],
            superseded: ["x2"],
          }),
        }),
      },
      { s1: 3, s2: 9 },
    );
    expect(merged.brief?.queue.map((q) => q.id)).toEqual(["b1", "a1"]);
    expect(merged.brief?.checkOn).toEqual(["c2", "c1"]);
    expect(merged.brief?.superseded).toEqual(["x2", "x1"]);
  });

  it("a host with no brief still contributes its state", () => {
    const merged = mergeHomeSnapshots(
      {
        s1: snapshot({ brief: brief({ headline: "Only" }) }),
        s2: snapshot({ brief: null, state: { snoozed: { z: "2026-11-19T09:00:00.000Z" } } }),
      },
      { s1: 4, s2: 40 },
    );
    expect(merged.brief?.headline).toBe("Only");
    expect(merged.state.snoozed).toEqual({ z: "2026-11-19T09:00:00.000Z" });
  });

  it("merges snoozed and kept, sums closed today, ors briefRunning", () => {
    const merged = mergeHomeSnapshots(
      {
        s1: snapshot({
          closedToday: 2,
          state: {
            snoozed: { a: "2026-11-19T09:00:00.000Z" },
            kept: { k1: "2026-11-25T09:00:00.000Z" },
          },
        }),
        s2: snapshot({
          closedToday: 5,
          briefRunning: true,
          state: {
            snoozed: { b: "2026-11-20T09:00:00.000Z" },
            kept: { k2: "2026-11-26T09:00:00.000Z" },
          },
        }),
      },
      { s1: 1, s2: 1 },
    );
    expect(merged.state.snoozed).toEqual({
      a: "2026-11-19T09:00:00.000Z",
      b: "2026-11-20T09:00:00.000Z",
    });
    expect(Object.keys(merged.state.kept).sort()).toEqual(["k1", "k2"]);
    expect(merged.closedToday).toBe(7);
    expect(merged.briefRunning).toBe(true);
  });

  it("keeps the newest Chief layout", () => {
    const layout = (title: string, createdAt: string) => ({
      title,
      reason: "r",
      createdAt,
      groups: [],
    });
    const merged = mergeHomeSnapshots(
      {
        s1: snapshot({ state: { chiefLayout: layout("old", "2026-11-18T08:00:00.000Z") } }),
        s2: snapshot({ state: { chiefLayout: layout("new", "2026-11-18T09:00:00.000Z") } }),
      },
      {},
    );
    expect(merged.state.chiefLayout?.title).toBe("new");
  });
});

describe("hostsWithLayout", () => {
  it("lists the hosts that hold a layout, sorted: Back to normal goes to each", () => {
    const layout = { title: "t", reason: "r", createdAt: "2026-11-18T08:00:00.000Z", groups: [] };
    expect(
      hostsWithLayout({
        s2: snapshot({ state: { chiefLayout: layout } }),
        s1: snapshot(),
        s0: snapshot({ state: { chiefLayout: layout } }),
      }),
    ).toEqual(["s0", "s2"]);
  });
});

describe("closed today", () => {
  it("localDayKey is the local calendar day", () => {
    expect(localDayKey(new Date(2026, 10, 8, 23, 59))).toBe("2026-11-08");
  });

  it("the daemons' count wins; the local count stands in only without one, and only for today", () => {
    const local = { day: "2026-11-18", count: 3 };
    expect(resolveClosedToday({ merged: 9, local, today: "2026-11-18" })).toBe(9);
    expect(resolveClosedToday({ merged: 0, local, today: "2026-11-18" })).toBe(0);
    expect(resolveClosedToday({ merged: null, local, today: "2026-11-18" })).toBe(3);
    expect(resolveClosedToday({ merged: null, local, today: "2026-11-19" })).toBe(0);
  });
});

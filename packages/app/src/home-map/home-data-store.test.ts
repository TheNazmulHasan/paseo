import { beforeEach, describe, expect, it } from "vitest";
import type { HomeSnapshot } from "@getpaseo/protocol/home";
import { useHomeDataStore } from "./home-data-store";

function snap(headline: string, updatedAt: string, closedToday = 0): HomeSnapshot {
  return {
    brief: {
      headline,
      since: null,
      queue: [],
      checkOn: [],
      superseded: [],
      generatedAt: updatedAt,
    },
    state: { snoozed: {}, kept: {}, chiefLayout: null },
    closedToday,
    briefRunning: false,
    updatedAt,
  };
}

const T1 = "2026-11-18T08:00:00.000Z";
const T2 = "2026-11-18T08:05:00.000Z";
const T3 = "2026-11-18T08:10:00.000Z";

describe("useHomeDataStore", () => {
  beforeEach(() => {
    useHomeDataStore.setState({ snapshots: {}, pushCounts: {} });
  });

  const headlineOf = (serverId: string) =>
    useHomeDataStore.getState().snapshots[serverId]?.brief?.headline;

  it("holds one snapshot per host", () => {
    const store = useHomeDataStore.getState();
    store.applyPush("s1", snap("one", T1));
    store.applyPush("s2", snap("two", T1));
    expect(headlineOf("s1")).toBe("one");
    expect(headlineOf("s2")).toBe("two");
  });

  it("applies a get when no push happened meanwhile", () => {
    const store = useHomeDataStore.getState();
    const ticket = store.beginGet("s1");
    expect(store.applyGet("s1", ticket, snap("from get", T1))).toBe(true);
    expect(headlineOf("s1")).toBe("from get");
  });

  it("drops a get that lands after a push", () => {
    const store = useHomeDataStore.getState();
    const ticket = store.beginGet("s1");
    store.applyPush("s1", snap("pushed", T2));
    expect(store.applyGet("s1", ticket, snap("late get", T1))).toBe(false);
    expect(headlineOf("s1")).toBe("pushed");
  });

  it("a push on another host does not make this host's get stale", () => {
    const store = useHomeDataStore.getState();
    const ticket = store.beginGet("s1");
    store.applyPush("s2", snap("other", T2));
    expect(store.applyGet("s1", ticket, snap("mine", T1))).toBe(true);
    expect(headlineOf("s1")).toBe("mine");
  });

  it("a second get started after the push is fresh and applies", () => {
    const store = useHomeDataStore.getState();
    store.applyPush("s1", snap("pushed", T2));
    const ticket = store.beginGet("s1");
    expect(store.applyGet("s1", ticket, snap("fresh get", T3))).toBe(true);
    expect(headlineOf("s1")).toBe("fresh get");
  });

  it("never replaces a snapshot with an older one (an action reply overtaken by a push)", () => {
    const store = useHomeDataStore.getState();
    store.applyPush("s1", snap("newer", T3));
    store.applyPush("s1", snap("older reply", T1));
    expect(headlineOf("s1")).toBe("newer");
    const ticket = store.beginGet("s1");
    expect(store.applyGet("s1", ticket, snap("older get", T2))).toBe(false);
    expect(headlineOf("s1")).toBe("newer");
  });

  it("clearHost forgets a host", () => {
    const store = useHomeDataStore.getState();
    store.applyPush("s1", snap("one", T1));
    store.clearHost("s1");
    expect(useHomeDataStore.getState().snapshots.s1).toBeUndefined();
  });
});

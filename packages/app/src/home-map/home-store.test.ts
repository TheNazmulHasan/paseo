import { beforeEach, describe, expect, it } from "vitest";
import { addClosedToday, migrateHomeState, useHomeStore } from "./home-store";

describe("migrateHomeState", () => {
  it("turns junk and the removed v1 map shape into the defaults", () => {
    const empty = { closedTodayLocal: { day: "", count: 0 }, queueSort: "priority" };
    for (const junk of [
      null,
      undefined,
      42,
      "x",
      [],
      { baseline: "open", overrides: {}, showQuiet: true },
      { closedTodayLocal: { day: "2026-11-18", count: -1 } },
      { closedTodayLocal: { day: "", count: 0 }, queueSort: "sideways" },
    ]) {
      expect(migrateHomeState(junk)).toEqual(empty);
    }
  });

  it("keeps a valid persisted state", () => {
    const stored = { closedTodayLocal: { day: "2026-11-18", count: 3 }, queueSort: "folder" };
    expect(migrateHomeState(stored)).toEqual(stored);
  });

  it("an older state without a sort gets the default", () => {
    expect(migrateHomeState({ closedTodayLocal: { day: "2026-11-18", count: 3 } })).toEqual({
      closedTodayLocal: { day: "2026-11-18", count: 3 },
      queueSort: "priority",
    });
  });
});

describe("addClosedToday", () => {
  it("adds on the same day and restarts on a new one", () => {
    expect(addClosedToday({ day: "2026-11-18", count: 2 }, 3, "2026-11-18")).toEqual({
      day: "2026-11-18",
      count: 5,
    });
    expect(addClosedToday({ day: "2026-11-17", count: 9 }, 1, "2026-11-18")).toEqual({
      day: "2026-11-18",
      count: 1,
    });
  });

  it("an undo takes closes back off and never goes below 0", () => {
    expect(addClosedToday({ day: "2026-11-18", count: 2 }, -1, "2026-11-18").count).toBe(1);
    expect(addClosedToday({ day: "2026-11-18", count: 1 }, -5, "2026-11-18").count).toBe(0);
  });
});

describe("useHomeStore", () => {
  it("remembers the queue sort", () => {
    useHomeStore.getState().setQueueSort("recent");
    expect(useHomeStore.getState().queueSort).toBe("recent");
  });

  beforeEach(() => {
    useHomeStore.setState({ closedTodayLocal: { day: "", count: 0 }, queueSort: "priority" });
  });

  it("counts the sessions closed from Home today", () => {
    useHomeStore.getState().recordClosed(2, "2026-11-18");
    useHomeStore.getState().recordClosed(1, "2026-11-18");
    expect(useHomeStore.getState().closedTodayLocal).toEqual({ day: "2026-11-18", count: 3 });
    useHomeStore.getState().recordClosed(-1, "2026-11-18");
    expect(useHomeStore.getState().closedTodayLocal.count).toBe(2);
  });
});

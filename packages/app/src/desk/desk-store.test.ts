import { beforeEach, describe, expect, it } from "vitest";
import { migrateDeskState, useDeskStore } from "@/desk/desk-store";

describe("migrateDeskState", () => {
  it("turns junk into an empty, unseeded Desk with the Shelf folded", () => {
    for (const junk of [null, undefined, 42, "x", [], { deskKeys: "nope" }, { extra: true }]) {
      expect(migrateDeskState(junk)).toEqual({
        deskKeys: [],
        seenKeys: [],
        seenHosts: [],
        seeded: false,
        shelfCollapsed: true,
        deskCollapsed: false,
        deskGrouping: "recent",
      });
    }
  });

  it("rejects an unknown grouping instead of crashing", () => {
    expect(migrateDeskState({ deskGrouping: "label" }).deskGrouping).toBe("recent");
  });

  it("keeps a valid persisted state and fills missing fields with defaults", () => {
    expect(migrateDeskState({ deskKeys: ["s:a"], seeded: true, deskGrouping: "status" })).toEqual({
      deskKeys: ["s:a"],
      seenKeys: [],
      seenHosts: [],
      seeded: true,
      shelfCollapsed: true,
      deskCollapsed: false,
      deskGrouping: "status",
    });
  });
});

describe("useDeskStore", () => {
  beforeEach(() => {
    useDeskStore.setState({
      deskKeys: [],
      seenKeys: [],
      seenHosts: [],
      seeded: false,
      shelfCollapsed: true,
      deskCollapsed: false,
      deskGrouping: "recent",
    });
  });

  it("toggles a workspace on and off the Desk", () => {
    expect(useDeskStore.getState().toggleDesk("s:a")).toBe(true);
    expect(useDeskStore.getState().deskKeys).toEqual(["s:a"]);
    expect(useDeskStore.getState().toggleDesk("s:a")).toBe(false);
    expect(useDeskStore.getState().deskKeys).toEqual([]);
  });

  it("restores cleared keys without duplicating ones already back", () => {
    useDeskStore.setState({ deskKeys: ["s:a", "s:b"] });
    useDeskStore.getState().removeDeskKeys(["s:a", "s:b"]);
    useDeskStore.getState().putOnDesk("s:b");
    useDeskStore.getState().restoreDeskKeys(["s:a", "s:b"]);
    expect(useDeskStore.getState().deskKeys.sort()).toEqual(["s:a", "s:b"]);
  });

  it("persists folding the Shelf and the Desk grouping", () => {
    useDeskStore.getState().toggleShelfCollapsed();
    useDeskStore.getState().setDeskGrouping("project");
    expect(useDeskStore.getState().shelfCollapsed).toBe(false);
    expect(useDeskStore.getState().deskGrouping).toBe("project");
  });

  it("folds and unfolds the Desk, starting open", () => {
    expect(useDeskStore.getState().deskCollapsed).toBe(false);
    useDeskStore.getState().toggleDeskCollapsed();
    expect(useDeskStore.getState().deskCollapsed).toBe(true);
    useDeskStore.getState().toggleDeskCollapsed();
    expect(useDeskStore.getState().deskCollapsed).toBe(false);
  });
});

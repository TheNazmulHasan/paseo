import { beforeEach, describe, expect, it } from "vitest";
import { migrateSidebarTabsState, useSidebarTabsStore } from "@/sidebar-tabs/open-store";

describe("migrateSidebarTabsState", () => {
  it("turns junk into every list folded", () => {
    for (const junk of [null, undefined, 42, "x", [], { openKeys: "nope" }, { extra: true }]) {
      expect(migrateSidebarTabsState(junk)).toEqual({ openKeys: [] });
    }
  });

  it("keeps a valid persisted state", () => {
    expect(migrateSidebarTabsState({ openKeys: ["s1:w1", "board:b1"] })).toEqual({
      openKeys: ["s1:w1", "board:b1"],
    });
  });
});

describe("useSidebarTabsStore", () => {
  beforeEach(() => {
    useSidebarTabsStore.setState({ openKeys: [] });
  });

  it("starts folded, and opens and folds each row on its own", () => {
    useSidebarTabsStore.getState().toggle("s1:w1");
    useSidebarTabsStore.getState().toggle("board:b1");
    expect(useSidebarTabsStore.getState().openKeys).toEqual(["s1:w1", "board:b1"]);
    useSidebarTabsStore.getState().toggle("s1:w1");
    expect(useSidebarTabsStore.getState().openKeys).toEqual(["board:b1"]);
  });
});

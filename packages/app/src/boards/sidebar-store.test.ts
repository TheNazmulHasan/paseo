import { beforeEach, describe, expect, it } from "vitest";
import { migrateViewsSidebarState, useViewsSidebarStore } from "@/boards/sidebar-store";

describe("migrateViewsSidebarState", () => {
  it("turns junk into an open section", () => {
    for (const junk of [null, undefined, 42, "x", [], { collapsed: "yes" }, { extra: true }]) {
      expect(migrateViewsSidebarState(junk)).toEqual({ collapsed: false });
    }
  });

  it("keeps a valid persisted state", () => {
    expect(migrateViewsSidebarState({ collapsed: true })).toEqual({ collapsed: true });
  });
});

describe("useViewsSidebarStore", () => {
  beforeEach(() => {
    useViewsSidebarStore.setState({ collapsed: false });
  });

  it("starts open and toggles", () => {
    expect(useViewsSidebarStore.getState().collapsed).toBe(false);
    useViewsSidebarStore.getState().toggleCollapsed();
    expect(useViewsSidebarStore.getState().collapsed).toBe(true);
    useViewsSidebarStore.getState().toggleCollapsed();
    expect(useViewsSidebarStore.getState().collapsed).toBe(false);
  });
});

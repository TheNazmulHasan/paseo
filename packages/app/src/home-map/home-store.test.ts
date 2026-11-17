import { beforeEach, describe, expect, it } from "vitest";
import { migrateHomeState, useHomeStore } from "./home-store";
import { isNodeOpen } from "./model";

describe("migrateHomeState", () => {
  it("turns junk into the defaults", () => {
    for (const junk of [null, undefined, 42, "x", [], { baseline: "sideways" }, { extra: true }]) {
      expect(migrateHomeState(junk)).toEqual({
        baseline: "default",
        overrides: {},
        showQuiet: false,
      });
    }
  });

  it("keeps a valid persisted state", () => {
    const stored = { baseline: "open", overrides: { "folder:faith": false }, showQuiet: true };
    expect(migrateHomeState(stored)).toEqual(stored);
  });
});

describe("useHomeStore", () => {
  beforeEach(() => {
    useHomeStore.setState({ baseline: "default", overrides: {}, showQuiet: false });
  });

  it("toggles nodes one by one", () => {
    useHomeStore.getState().toggleNode("ws:faith:s1:w1", "workspace");
    expect(isNodeOpen(useHomeStore.getState(), "ws:faith:s1:w1", "workspace")).toBe(true);
    useHomeStore.getState().toggleNode("ws:faith:s1:w1", "workspace");
    expect(isNodeOpen(useHomeStore.getState(), "ws:faith:s1:w1", "workspace")).toBe(false);
  });

  it("Unfold all and Fold all reset every hand-made choice", () => {
    useHomeStore.getState().toggleNode("folder:faith", "folder");
    useHomeStore.getState().setAll(true);
    expect(useHomeStore.getState()).toMatchObject({ baseline: "open", overrides: {} });
    expect(isNodeOpen(useHomeStore.getState(), "folder:faith", "folder")).toBe(true);
    useHomeStore.getState().setAll(false);
    expect(useHomeStore.getState()).toMatchObject({ baseline: "folded", overrides: {} });
    expect(isNodeOpen(useHomeStore.getState(), "folder:faith", "folder")).toBe(false);
  });

  it("Show quiet is off by default and switches on and off", () => {
    expect(useHomeStore.getState().showQuiet).toBe(false);
    useHomeStore.getState().setShowQuiet(true);
    expect(useHomeStore.getState().showQuiet).toBe(true);
    useHomeStore.getState().setShowQuiet(false);
    expect(useHomeStore.getState().showQuiet).toBe(false);
  });
});

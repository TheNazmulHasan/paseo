import { beforeEach, describe, expect, it } from "vitest";
import {
  pruneSelectionKeys,
  toggleSelectionKey,
  useDeskSelectionStore,
} from "@/desk/desk-selection-store";

describe("selection helpers", () => {
  it("appends in check order and removes on second toggle", () => {
    expect(toggleSelectionKey(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelectionKey(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("prunes keys that left the Desk, keeping order", () => {
    expect(pruneSelectionKeys(["c", "a", "b"], new Set(["a", "c"]))).toEqual(["c", "a"]);
  });
});

describe("desk selection store", () => {
  beforeEach(() => {
    useDeskSelectionStore.setState({ active: false, checked: [] });
  });

  it("toggle enters selection mode and keeps check order", () => {
    const store = useDeskSelectionStore.getState();
    store.toggle("w2");
    store.toggle("w1");
    expect(useDeskSelectionStore.getState()).toMatchObject({ active: true, checked: ["w2", "w1"] });
  });

  it("exit clears the mode and the checks", () => {
    const store = useDeskSelectionStore.getState();
    store.toggle("w1");
    store.exit();
    expect(useDeskSelectionStore.getState()).toMatchObject({ active: false, checked: [] });
  });

  it("toggleMode off drops the checks, on keeps none", () => {
    const store = useDeskSelectionStore.getState();
    store.toggleMode();
    expect(useDeskSelectionStore.getState().active).toBe(true);
    store.toggle("w1");
    store.toggleMode();
    expect(useDeskSelectionStore.getState()).toMatchObject({ active: false, checked: [] });
  });

  it("prune drops checks for workspaces no longer on the Desk", () => {
    const store = useDeskSelectionStore.getState();
    store.toggle("w1");
    store.toggle("w2");
    store.prune(new Set(["w2"]));
    expect(useDeskSelectionStore.getState().checked).toEqual(["w2"]);
  });
});

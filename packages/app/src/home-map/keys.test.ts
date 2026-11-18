import { describe, expect, it } from "vitest";
import { decideHomeKey, type HomeKeyInput } from "./keys";

function press(key: string, over: Partial<HomeKeyInput> = {}) {
  return decideHomeKey({
    key,
    editing: false,
    onControl: false,
    itemCount: 5,
    focusedIndex: 1,
    focusedHasActions: true,
    menuOpen: false,
    overlay: "none",
    ...over,
  });
}

describe("decideHomeKey: the queue", () => {
  it("1-9 focus that item, as long as it is on screen", () => {
    expect(press("1")).toEqual({ type: "focus", index: 0 });
    expect(press("5")).toEqual({ type: "focus", index: 4 });
    expect(press("6")).toBeNull();
    expect(press("9", { itemCount: 9 })).toEqual({ type: "focus", index: 8 });
    expect(press("0")).toBeNull();
  });

  it("works with nothing focused yet: a number focuses, the rest do nothing", () => {
    expect(press("2", { focusedIndex: null })).toEqual({ type: "focus", index: 1 });
    expect(press("Enter", { focusedIndex: null })).toBeNull();
    expect(press("l", { focusedIndex: null })).toBeNull();
    expect(press("c", { focusedIndex: null })).toBeNull();
  });

  it("Enter opens, L opens the Later menu, C closes (any letter case)", () => {
    expect(press("Enter")).toEqual({ type: "open" });
    expect(press("l")).toEqual({ type: "later" });
    expect(press("L")).toEqual({ type: "later" });
    expect(press("c")).toEqual({ type: "close" });
    expect(press("C")).toEqual({ type: "close" });
  });

  it("an item with only Open (a Chief layout item) ignores L and C but Enter still opens", () => {
    expect(press("l", { focusedHasActions: false })).toBeNull();
    expect(press("c", { focusedHasActions: false })).toBeNull();
    expect(press("Enter", { focusedHasActions: false })).toEqual({ type: "open" });
  });

  it("Enter on a focused button belongs to the button, so it does not fire twice", () => {
    expect(press("Enter", { onControl: true })).toBeNull();
    expect(press("c", { onControl: true })).toEqual({ type: "close" });
  });

  it("ignores everything while a text field has focus or a menu is open", () => {
    for (const key of ["1", "Enter", "l", "c"]) {
      expect(press(key, { editing: true })).toBeNull();
      expect(press(key, { menuOpen: true })).toBeNull();
    }
  });

  it("ignores Ctrl, Cmd and Alt combinations: those belong to the app's own shortcuts", () => {
    expect(press("c", { ctrlKey: true })).toBeNull();
    expect(press("1", { metaKey: true })).toBeNull();
    expect(press("Enter", { altKey: true })).toBeNull();
  });

  it("other keys do nothing", () => {
    expect(press("x")).toBeNull();
    expect(press("ArrowDown")).toBeNull();
    expect(press("Escape")).toBeNull();
  });
});

describe("decideHomeKey: Sweep and the Chief drawer", () => {
  it("Sweep: K keeps, C closes, Enter opens, Esc leaves", () => {
    expect(press("k", { overlay: "sweep" })).toEqual({ type: "sweep-keep" });
    expect(press("K", { overlay: "sweep" })).toEqual({ type: "sweep-keep" });
    expect(press("c", { overlay: "sweep" })).toEqual({ type: "sweep-close" });
    expect(press("Enter", { overlay: "sweep" })).toEqual({ type: "sweep-open" });
    expect(press("Escape", { overlay: "sweep" })).toEqual({ type: "escape" });
  });

  it("Sweep does not run the queue keys behind it", () => {
    expect(press("1", { overlay: "sweep" })).toBeNull();
    expect(press("l", { overlay: "sweep" })).toBeNull();
  });

  it("the drawer only answers Esc", () => {
    expect(press("Escape", { overlay: "drawer" })).toEqual({ type: "escape" });
    expect(press("1", { overlay: "drawer" })).toBeNull();
    expect(press("c", { overlay: "drawer" })).toBeNull();
    expect(press("Enter", { overlay: "drawer" })).toBeNull();
  });

  it("Esc leaves an overlay even from a text field, but is nothing on the plain queue", () => {
    expect(press("Escape", { overlay: "drawer", editing: true })).toEqual({ type: "escape" });
    expect(press("Escape", { overlay: "none", editing: true })).toBeNull();
  });

  it("typing in a field while Sweep is open keeps its keys", () => {
    expect(press("k", { overlay: "sweep", editing: true })).toBeNull();
  });
});

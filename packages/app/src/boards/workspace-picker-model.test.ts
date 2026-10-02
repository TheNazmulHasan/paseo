import { describe, expect, it } from "vitest";
import {
  canSplit,
  filterPickerWorkspaces,
  layoutForEnter,
  moveHighlight,
  orderPickerWorkspaces,
  resolveSplitViewport,
  togglePickedKey,
} from "@/boards/workspace-picker-model";

const item = (key: string, title = key, projectName = "proj") => ({ key, title, projectName });

describe("orderPickerWorkspaces", () => {
  it("lists the current workspace first, then the Desk, then the rest", () => {
    const items = ["a", "b", "c", "d", "e"].map((key) => item(key));
    expect(
      orderPickerWorkspaces(items, { currentKey: "c", deskKeys: new Set(["e", "b"]) }).map(
        (entry) => entry.key,
      ),
    ).toEqual(["c", "b", "e", "a", "d"]);
  });

  it("works without a current workspace or a Desk", () => {
    const items = ["a", "b"].map((key) => item(key));
    expect(
      orderPickerWorkspaces(items, { currentKey: null, deskKeys: new Set() }).map((e) => e.key),
    ).toEqual(["a", "b"]);
  });
});

describe("filterPickerWorkspaces", () => {
  const items = [
    item("1", "Fix login", "web-app"),
    item("2", "Docs", "web-app"),
    item("3", "Fix build", "cli"),
  ];

  it("returns everything for a blank query", () => {
    expect(filterPickerWorkspaces(items, "  ")).toBe(items);
  });

  it("needs every word to match the title or the project", () => {
    expect(filterPickerWorkspaces(items, "fix web").map((e) => e.key)).toEqual(["1"]);
    expect(filterPickerWorkspaces(items, "WEB-APP").map((e) => e.key)).toEqual(["1", "2"]);
  });
});

describe("togglePickedKey and canSplit", () => {
  it("keeps pick order and unchecks by removing", () => {
    expect(togglePickedKey(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePickedKey(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("needs at least two workspaces", () => {
    expect(canSplit([])).toBe(false);
    expect(canSplit(["a"])).toBe(false);
    expect(canSplit(["a", "b"])).toBe(true);
  });
});

describe("layoutForEnter and moveHighlight", () => {
  it("maps Enter to columns and Shift+Enter to grid", () => {
    expect(layoutForEnter(false)).toBe("columns");
    expect(layoutForEnter(true)).toBe("grid");
  });

  it("wraps the highlight in both directions and survives an empty list", () => {
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, 1, 0)).toBe(0);
  });
});

describe("resolveSplitViewport", () => {
  it("prefers the measured split area", () => {
    expect(
      resolveSplitViewport({
        measured: { width: 900, height: 700 },
        windowSize: { width: 1600, height: 1000 },
      }),
    ).toEqual({ width: 900, height: 700 });
  });

  it("falls back to the window minus the sidebar", () => {
    expect(
      resolveSplitViewport({ measured: null, windowSize: { width: 1600, height: 1000 } }),
    ).toEqual({ width: 1280, height: 1000 });
  });
});

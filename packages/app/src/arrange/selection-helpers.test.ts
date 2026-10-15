import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import {
  isSelectionModifier,
  orderedWorkspaceTabIds,
  resolveSelectionGesture,
  staleSelectedTabIds,
} from "./selection-helpers";

const layout: WorkspaceLayout = {
  focusedPaneId: "a",
  root: {
    kind: "group",
    group: {
      id: "g1",
      direction: "horizontal",
      sizes: [0.5, 0.5],
      children: [
        { kind: "pane", pane: { id: "a", tabIds: ["t1", "t2"], focusedTabId: "t1" } },
        {
          kind: "group",
          group: {
            id: "g2",
            direction: "vertical",
            sizes: [0.5, 0.5],
            children: [
              { kind: "pane", pane: { id: "b", tabIds: ["t3"], focusedTabId: "t3" } },
              { kind: "pane", pane: { id: "c", tabIds: ["t4", "t5"], focusedTabId: "t4" } },
            ],
          },
        },
        {
          kind: "pane",
          pane: { id: "dock", tabIds: ["t6"], focusedTabId: "t6", hidden: true },
        },
      ],
    },
  },
};

describe("isSelectionModifier", () => {
  it("is Cmd on mac and ignores Ctrl", () => {
    expect(isSelectionModifier({ metaKey: true }, "mac")).toBe(true);
    expect(isSelectionModifier({ ctrlKey: true }, "mac")).toBe(false);
  });

  it("is Ctrl on non-mac and ignores Meta", () => {
    expect(isSelectionModifier({ ctrlKey: true }, "non-mac")).toBe(true);
    expect(isSelectionModifier({ metaKey: true }, "non-mac")).toBe(false);
  });

  it("is false for a plain or shift-only click", () => {
    expect(isSelectionModifier({}, "mac")).toBe(false);
    expect(isSelectionModifier({ shiftKey: true }, "non-mac")).toBe(false);
  });
});

describe("resolveSelectionGesture", () => {
  it("toggles on the platform modifier, even with Shift held", () => {
    expect(resolveSelectionGesture({ metaKey: true, shiftKey: true }, "mac", true)).toBe("toggle");
  });

  it("selects a range on Shift alone when ranges are allowed", () => {
    expect(resolveSelectionGesture({ shiftKey: true }, "mac", true)).toBe("range");
    expect(resolveSelectionGesture({ shiftKey: true }, "mac", false)).toBeNull();
  });

  it("does not treat Ctrl+Shift on mac as a range (it is the context-menu click)", () => {
    expect(resolveSelectionGesture({ ctrlKey: true, shiftKey: true }, "mac", true)).toBeNull();
  });

  it("leaves a plain click alone", () => {
    expect(resolveSelectionGesture({}, "non-mac", true)).toBeNull();
  });
});

describe("orderedWorkspaceTabIds", () => {
  it("walks panes left-to-right, top-to-bottom and skips hidden panes", () => {
    expect(orderedWorkspaceTabIds(layout)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("includes hidden panes on request", () => {
    expect(orderedWorkspaceTabIds(layout, { includeHidden: true })).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
    ]);
  });

  it("returns the strip order for a single pane", () => {
    const single: WorkspaceLayout = {
      focusedPaneId: "main",
      root: { kind: "pane", pane: { id: "main", tabIds: ["x", "y"], focusedTabId: "x" } },
    };
    expect(orderedWorkspaceTabIds(single)).toEqual(["x", "y"]);
  });
});

describe("staleSelectedTabIds", () => {
  it("returns selected ids that no tab owns, counting hidden panes as live", () => {
    expect(staleSelectedTabIds(["t1", "t6", "gone"], layout)).toEqual(["gone"]);
  });
});

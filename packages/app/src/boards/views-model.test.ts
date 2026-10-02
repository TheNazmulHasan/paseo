import { describe, expect, it } from "vitest";
import { isViewActive, orderViewRows, resolveRename, showRowActions } from "@/boards/views-model";
import type { BoardSummary } from "@/boards/types";

const summary = (id: string, kind: BoardSummary["kind"], sessionCount = 0): BoardSummary => ({
  id,
  name: id,
  kind,
  sessionCount,
});

describe("orderViewRows", () => {
  it("puts Live first and keeps the saved splits in order", () => {
    expect(
      orderViewRows([summary("a", "user"), summary("live", "live"), summary("b", "user")]).map(
        (row) => row.id,
      ),
    ).toEqual(["live", "a", "b"]);
  });

  it("works with no Live board yet", () => {
    expect(orderViewRows([summary("a", "user")]).map((row) => row.id)).toEqual(["a"]);
  });
});

describe("isViewActive", () => {
  it("matches only the board on screen", () => {
    expect(isViewActive("a", "a")).toBe(true);
    expect(isViewActive("a", "b")).toBe(false);
    expect(isViewActive(null, "a")).toBe(false);
  });
});

describe("resolveRename", () => {
  it("trims and ignores empty or unchanged names", () => {
    expect(resolveRename("Old", "  New ")).toBe("New");
    expect(resolveRename("Old", "Old")).toBeNull();
    expect(resolveRename("Old", "   ")).toBeNull();
  });
});

describe("showRowActions", () => {
  it("is always on for the active row, on hover elsewhere, always where there is no hover", () => {
    expect(showRowActions({ active: true, hovered: false, canHover: true })).toBe(true);
    expect(showRowActions({ active: false, hovered: true, canHover: true })).toBe(true);
    expect(showRowActions({ active: false, hovered: false, canHover: true })).toBe(false);
    expect(showRowActions({ active: false, hovered: false, canHover: false })).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createRenameSession,
  isViewActive,
  pinnedSectionCount,
  resolveRename,
  showRowActions,
} from "@/boards/views-model";

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

describe("createRenameSession", () => {
  function start(initialValue = "A | B") {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    return {
      session: createRenameSession({ initialValue, onCommit, onCancel }),
      onCommit,
      onCancel,
    };
  }

  it("Enter saves what was typed", () => {
    const { session, onCommit, onCancel } = start();
    session.change("Backlog");
    session.submit();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clicking away saves what was typed", () => {
    const { session, onCommit, onCancel } = start();
    session.change("Backlog");
    session.blur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape cancels, and the blur that follows does not save", () => {
    const { session, onCommit, onCancel } = start();
    session.change("Backlog");
    session.cancel();
    session.blur();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Enter then the blur it causes saves once, not twice", () => {
    const { session, onCommit } = start();
    session.change("Backlog");
    session.submit();
    session.blur();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("with nothing typed it hands back the old name, which resolveRename then drops", () => {
    const { session, onCommit } = start("A | B");
    session.blur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("A | B");
    expect(resolveRename("A | B", "A | B")).toBeNull();
  });
});

describe("pinnedSectionCount", () => {
  it("counts the views and the pinned workspaces as one", () => {
    expect(pinnedSectionCount(3, 2)).toBe(5);
  });

  it("still counts the views when nothing is pinned", () => {
    expect(pinnedSectionCount(1, 0)).toBe(1);
  });
});

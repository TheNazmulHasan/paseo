import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  arrangeWorkspace: vi.fn(() => true),
  toggleWatchMode: vi.fn(() => true),
  restoreWorkspaceArrangement: vi.fn(() => true),
  equalizeWorkspacePanes: vi.fn(() => true),
}));
vi.mock("@/arrange/controller", () => controller);

import {
  arrangeCommandFromActionId,
  resolveArrangeMenuKey,
  runArrangeCommand,
} from "@/arrange/run-command";

const viewport = { width: 1200, height: 800 };

describe("arrange commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["single", "single"],
    ["columns2", "columns-2"],
    ["columns3", "columns-3"],
    ["grid", "grid"],
  ] as const)("%s arranges the %s preset into the viewport", (command, preset) => {
    expect(runArrangeCommand(command, { workspaceKey: "ws", viewport })).toBe(true);
    expect(controller.arrangeWorkspace).toHaveBeenCalledWith({
      workspaceKey: "ws",
      preset,
      viewport,
    });
  });

  it("routes watch, restore and equalize to their controller functions", () => {
    runArrangeCommand("watch", { workspaceKey: "ws", viewport });
    runArrangeCommand("restore", { workspaceKey: "ws", viewport });
    runArrangeCommand("equalize", { workspaceKey: "ws", viewport });
    expect(controller.toggleWatchMode).toHaveBeenCalledWith({ workspaceKey: "ws", viewport });
    expect(controller.restoreWorkspaceArrangement).toHaveBeenCalledWith("ws");
    expect(controller.equalizeWorkspacePanes).toHaveBeenCalledWith("ws");
  });

  it("maps action ids to commands and ignores the ones that are not commands", () => {
    expect(arrangeCommandFromActionId("workspace.arrange.columns3")).toBe("columns3");
    expect(arrangeCommandFromActionId("workspace.arrange.menu")).toBeNull();
    expect(arrangeCommandFromActionId("workspace.arrange.select-tab")).toBeNull();
    expect(arrangeCommandFromActionId("workspace.pane.close")).toBeNull();
  });

  it("maps the menu's bare keys, with R as restore, and ignores modified keys", () => {
    expect(resolveArrangeMenuKey({ key: "1" })).toBe("single");
    expect(resolveArrangeMenuKey({ key: "2" })).toBe("columns2");
    expect(resolveArrangeMenuKey({ key: "3" })).toBe("columns3");
    expect(resolveArrangeMenuKey({ key: "G" })).toBe("grid");
    expect(resolveArrangeMenuKey({ key: "w" })).toBe("watch");
    expect(resolveArrangeMenuKey({ key: "r" })).toBe("restore");
    expect(resolveArrangeMenuKey({ key: "e" })).toBe("equalize");
    expect(resolveArrangeMenuKey({ key: "z" })).toBeNull();
    expect(resolveArrangeMenuKey({ key: "1", metaKey: true })).toBeNull();
  });
});

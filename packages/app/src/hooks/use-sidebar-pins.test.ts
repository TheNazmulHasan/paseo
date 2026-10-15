import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";

function placement(workspaceKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey,
    serverId: "s1",
    workspaceId: workspaceKey,
    projectViewKey: "p1",
    projectName: "Project 1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceKey,
  };
}

function project(projectKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey: projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: "",
    hosts: [],
    workspaces,
  };
}

describe("splitPinnedSidebarGroups", () => {
  it("keeps the project shell reachable when every chat is pinned", () => {
    const only = placement("w1");
    const projects = [project("p1", [only])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
      pinnedWorkspaceOrder: [],
    });
    expect(result.pinnedChats).toHaveLength(1);
    expect(result.unpinnedProjects).toEqual([{ ...projects[0], workspaces: [] }]);
  });

  it("keeps a genuinely empty project so its new-workspace row stays reachable", () => {
    const projects = [project("p1", [])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      pinnedWorkspaceOrder: [],
    });
    expect(result.unpinnedProjects).toHaveLength(1);
  });

  it("keeps remaining chats when only some are pinned", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
      pinnedWorkspaceOrder: [],
    });
    expect(result.pinnedChats.map((w) => w.workspaceKey)).toEqual(["w1"]);
    expect(result.unpinnedProjects[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w2"]);
  });

  it("orders pinned chats by most-recently-pinned first", () => {
    const projects = [project("p1", [placement("older"), placement("newer")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: [],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("applies the saved order while keeping a newly pinned chat first", () => {
    const projects = [project("p1", [placement("older"), placement("newer"), placement("new")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer", "new"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
          new: "2026-03-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: ["older", "newer"],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "new",
      "older",
      "newer",
    ]);
  });
});

describe("splitPinnedSidebarGroups under the recent sort", () => {
  function entry(workspaceKey: string, statusEnteredAt: Date | null): SidebarWorkspaceEntry {
    return {
      ...placement(workspaceKey),
      status: "done",
      statusEnteredAt,
      pinnedAt: null,
      labels: [],
      archivingAt: null,
      diffStat: null,
      prHint: null,
      isCreating: false,
    } as unknown as SidebarWorkspaceEntry;
  }

  it("orders pinned chats by activity and ignores pinned-at and the drag order", () => {
    const projects = [project("p1", [placement("w1"), placement("w2"), placement("w3")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1", "w2", "w3"],
        pinnedAtByKey: {
          w1: "2026-03-01T00:00:00Z",
          w2: "2026-02-01T00:00:00Z",
          w3: "2026-01-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: ["w2", "w1", "w3"],
      sortMode: "recent",
      workspaceEntriesByKey: new Map([
        ["w1", entry("w1", new Date("2026-08-01T00:00:00Z"))],
        ["w2", entry("w2", null)],
        ["w3", entry("w3", new Date("2026-08-30T00:00:00Z"))],
      ]),
    });
    expect(result.pinnedChats.map((chat) => chat.workspaceKey)).toEqual(["w3", "w1", "w2"]);
  });

  it("keeps the pinned-at + drag order when the sort is manual", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1", "w2"],
        pinnedAtByKey: { w1: "2026-03-01T00:00:00Z", w2: "2026-02-01T00:00:00Z" },
      },
      pinnedWorkspaceOrder: ["w2", "w1"],
      sortMode: "manual",
      workspaceEntriesByKey: new Map([
        ["w1", entry("w1", new Date("2026-08-01T00:00:00Z"))],
        ["w2", entry("w2", new Date("2026-08-30T00:00:00Z"))],
      ]),
    });
    expect(result.pinnedChats.map((chat) => chat.workspaceKey)).toEqual(["w2", "w1"]);
  });
});

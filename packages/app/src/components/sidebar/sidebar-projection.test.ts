import { i18n } from "@/i18n/i18next";
import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildFolderIndex, UNFILED_FOLDER_KEY } from "@/folders/model";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    t: i18n.t,
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});

function workspaceIds(rows: readonly { workspaceId: string }[]): string[] {
  return rows.map((row) => row.workspaceId);
}

describe("buildSidebarProjection — Desk and Shelf", () => {
  function deskInput(groupMode: "project" | "status", deskKeys: string[]) {
    const pinned = makeWorkspace("pinned", "running");
    const onDesk = makeWorkspace("on-desk", "needs_input");
    const onShelf = makeWorkspace("on-shelf", "done");
    return {
      ...projectionInput({ groupMode }),
      projects: [makeProject([pinned.placement, onShelf.placement, onDesk.placement])],
      workspaceEntriesByKey: new Map([
        [pinned.entry.workspaceKey, pinned.entry],
        [onDesk.entry.workspaceKey, onDesk.entry],
        [onShelf.entry.workspaceKey, onShelf.entry],
      ]),
      deskKeys: new Set(deskKeys),
    };
  }

  for (const groupMode of ["project", "status"] as const) {
    it(`moves Desk workspaces out of the ${groupMode} Shelf and numbers them after Pinned`, () => {
      const projection = buildSidebarProjection(deskInput(groupMode, ["srv:on-desk"]));

      expect(workspaceIds(projection.deskGroups.flatMap((group) => group.rows))).toEqual([
        "on-desk",
      ]);
      const shelfIds =
        groupMode === "project"
          ? workspaceIds(projection.pinnedGroups.unpinnedProjects.flatMap((p) => p.workspaces))
          : workspaceIds(projection.workspaceGroups.flatMap((group) => group.rows));
      expect(shelfIds).toEqual(["on-shelf"]);
      expect(projection.shelfCount).toBe(1);
      expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
        "pinned",
        "on-desk",
        "on-shelf",
      ]);
    });
  }

  it("keeps a pinned workspace out of the Desk even when it is marked", () => {
    const projection = buildSidebarProjection(deskInput("project", ["srv:pinned"]));

    expect(projection.deskGroups).toEqual([]);
    expect(projection.pinnedGroups.pinnedChats.map((w) => w.workspaceId)).toEqual(["pinned"]);
  });

  it("does not number a folded Shelf, only Pinned and Desk", () => {
    const projection = buildSidebarProjection({
      ...deskInput("status", ["srv:on-desk"]),
      shelfCollapsed: true,
    });

    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-desk",
    ]);
  });

  it("does not number a folded Desk, but keeps its rows and the count", () => {
    const projection = buildSidebarProjection({
      ...deskInput("status", ["srv:on-desk"]),
      deskCollapsed: true,
    });

    expect(workspaceIds(projection.deskGroups.flatMap((group) => group.rows))).toEqual(["on-desk"]);
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-shelf",
    ]);
  });

  it("folds the Desk away with the Folders section even when no host has folders", () => {
    const projection = buildSidebarProjection({
      ...deskInput("project", ["srv:on-desk"]),
      foldersSectionCollapsed: true,
    });

    expect(workspaceIds(projection.deskGroups.flatMap((group) => group.rows))).toEqual(["on-desk"]);
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-shelf",
    ]);
  });

  it("is the old projection when the Desk is empty", () => {
    const projection = buildSidebarProjection(deskInput("project", []));

    expect(projection.deskGroups).toEqual([]);
    expect(projection.shelfCount).toBe(2);
  });
});

describe("buildSidebarProjection — Folders replace the Shelf", () => {
  const faith = { id: "fld_faith", name: "Faith", emoji: "🕌", order: 0, createdAt: "2026-11-01" };

  function folderInput(options: {
    membership: Record<string, string>;
    deskKeys?: string[];
    openKeys?: string[];
    boards?: { id: string; name: string; kind: "user"; sessionCount: number }[];
    sectionCollapsed?: boolean;
    pinnedCollapsed?: boolean;
  }) {
    const pinned = makeWorkspace("pinned", "running");
    const onDesk = makeWorkspace("on-desk", "needs_input");
    const other = makeWorkspace("other", "done");
    return {
      ...projectionInput({ groupMode: "status", pinnedCollapsed: options.pinnedCollapsed }),
      projects: [makeProject([pinned.placement, onDesk.placement, other.placement])],
      workspaceEntriesByKey: new Map([
        [pinned.entry.workspaceKey, pinned.entry],
        [onDesk.entry.workspaceKey, onDesk.entry],
        [other.entry.workspaceKey, other.entry],
      ]),
      deskKeys: new Set(options.deskKeys ?? []),
      folders: {
        index: buildFolderIndex([
          { serverId: "srv", snapshot: { folders: [faith], membership: options.membership } },
        ]),
        boards: options.boards ?? [],
        openKeys: new Set(options.openKeys ?? []),
      },
      foldersSectionCollapsed: options.sectionCollapsed ?? false,
    };
  }

  it("is null (the Shelf shows) when no host has folders", () => {
    expect(buildSidebarProjection(projectionInput()).folderSections).toBeNull();
  });

  it("lists every workspace in its folder or Unfiled, Desk and Pinned ones included", () => {
    const projection = buildSidebarProjection(
      folderInput({
        membership: { "on-desk": "fld_faith", pinned: "fld_faith" },
        deskKeys: ["srv:on-desk"],
      }),
    );
    const sections = projection.folderSections ?? [];
    expect(sections.map((section) => section.key)).toEqual(["faith", UNFILED_FOLDER_KEY]);
    expect(workspaceIds(sections[0]?.workspaces ?? []).sort()).toEqual(["on-desk", "pinned"]);
    expect(workspaceIds(sections[1]?.workspaces ?? [])).toEqual(["other"]);
    // The Desk still shows its own workspace.
    expect(workspaceIds(projection.deskGroups.flatMap((group) => group.rows))).toEqual(["on-desk"]);
  });

  it("puts a filed view in its folder and an unfiled view in Unfiled", () => {
    const boards = [
      { id: "b1", name: "One", kind: "user" as const, sessionCount: 2 },
      { id: "b2", name: "Two", kind: "user" as const, sessionCount: 3 },
    ];
    const sections =
      buildSidebarProjection(folderInput({ membership: { "board:b1": "fld_faith" }, boards }))
        .folderSections ?? [];
    expect(sections[0]?.boards.map((board) => board.id)).toEqual(["b1"]);
    expect(sections[1]?.boards.map((board) => board.id)).toEqual(["b2"]);
    expect(sections.map((section) => section.count)).toEqual([1, 4]);
  });

  it("numbers open folders after Pinned and the Desk, and a repeated workspace once", () => {
    const projection = buildSidebarProjection(
      folderInput({
        membership: { "on-desk": "fld_faith", pinned: "fld_faith" },
        deskKeys: ["srv:on-desk"],
        openKeys: ["faith", UNFILED_FOLDER_KEY],
      }),
    );
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-desk",
      "other",
    ]);
    const sections = projection.folderSections ?? [];
    // Neither repeated row shows a number inside the folder; the Unfiled one does.
    expect([...(sections[0]?.numberedKeys ?? [])]).toEqual([]);
    expect([...(sections[1]?.numberedKeys ?? [])]).toEqual(["srv:other"]);
  });

  it("does not number folded folders, or any folder while the section is folded", () => {
    const folded = buildSidebarProjection(
      folderInput({ membership: {}, openKeys: [], deskKeys: ["srv:on-desk"] }),
    );
    expect(folded.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-desk",
    ]);
    const sectionFolded = buildSidebarProjection(
      folderInput({
        membership: {},
        openKeys: [UNFILED_FOLDER_KEY],
        sectionCollapsed: true,
        deskKeys: ["srv:on-desk"],
      }),
    );
    // The Desk is the first folder of the section, so folding the section folds the Desk too.
    expect(sectionFolded.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
    ]);
  });

  it("numbers Pinned, then the Desk folder, then user folders, then Unfiled, in display order", () => {
    const projection = buildSidebarProjection(
      folderInput({
        membership: { other: "fld_faith" },
        deskKeys: ["srv:on-desk"],
        openKeys: ["faith", UNFILED_FOLDER_KEY],
      }),
    );
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-desk",
      "other",
    ]);
  });

  it("numbers a Desk workspace once even when it also sits in an open user folder", () => {
    const projection = buildSidebarProjection(
      folderInput({
        membership: { "on-desk": "fld_faith" },
        deskKeys: ["srv:on-desk"],
        openKeys: ["faith"],
      }),
    );
    expect(
      projection.shortcutModel.shortcutTargets.filter((t) => t.workspaceId === "on-desk"),
    ).toHaveLength(1);
    expect([...(projection.folderSections?.[0]?.numberedKeys ?? [])]).toEqual([]);
  });

  it("numbers a Desk workspace in its open folder when the Desk folder is folded", () => {
    const projection = buildSidebarProjection({
      ...folderInput({
        membership: { "on-desk": "fld_faith" },
        deskKeys: ["srv:on-desk"],
        openKeys: ["faith"],
      }),
      deskCollapsed: true,
    });
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual([
      "pinned",
      "on-desk",
    ]);
    expect([...(projection.folderSections?.[0]?.numberedKeys ?? [])]).toEqual(["srv:on-desk"]);
  });

  it("numbers a pinned workspace in its folder when the Pinned section is folded", () => {
    const projection = buildSidebarProjection(
      folderInput({
        membership: { pinned: "fld_faith" },
        openKeys: ["faith"],
        pinnedCollapsed: true,
      }),
    );
    expect(projection.shortcutModel.shortcutTargets.map((t) => t.workspaceId)).toEqual(["pinned"]);
    expect([...(projection.folderSections?.[0]?.numberedKeys ?? [])]).toEqual(["srv:pinned"]);
  });

  it("groups the Desk by folder when asked", () => {
    const projection = buildSidebarProjection({
      ...folderInput({ membership: { "on-desk": "fld_faith" }, deskKeys: ["srv:on-desk"] }),
      deskGrouping: "folder" as const,
    });
    expect(projection.deskGroups.map((group) => group.label)).toEqual(["🕌 Faith"]);
  });
});

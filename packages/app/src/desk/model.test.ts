import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { mergeWorkspaceOrder } from "@/workspace-switcher/model";
import {
  buildDeskGroups,
  buildDeskRows,
  DESK_SEED_LIMIT,
  EMPTY_DESK_SYNC_STATE,
  flattenDeskGroups,
  orderKeysDeskFirst,
  partitionDeskWorkspaces,
  pickDeskSeed,
  reconcileDesk,
  selectClearableDeskKeys,
  splitDeskFromProjects,
  type DeskSyncState,
  type DeskWorkspaceFact,
} from "@/desk/model";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function fact(
  serverId: string,
  id: string,
  overrides: Partial<DeskWorkspaceFact> = {},
): DeskWorkspaceFact {
  return {
    workspaceKey: `${serverId}:${id}`,
    serverId,
    pinned: false,
    statusBucket: "done",
    statusEnteredAt: null,
    ...overrides,
  };
}

function placement(serverId: string, id: string, projectViewKey = "p1"): SidebarWorkspacePlacement {
  return {
    workspaceKey: `${serverId}:${id}`,
    serverId,
    workspaceId: id,
    projectViewKey,
    projectName: projectViewKey.toUpperCase(),
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
}

function entry(
  serverId: string,
  id: string,
  overrides: Partial<SidebarWorkspaceEntry> = {},
): SidebarWorkspaceEntry {
  return {
    ...placement(serverId, id, overrides.projectViewKey),
    statusBucket: "done",
    statusEnteredAt: null,
    ...overrides,
  } as SidebarWorkspaceEntry;
}

function project(viewKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey.toUpperCase(),
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [],
    workspaces,
  };
}

function seededState(overrides: Partial<DeskSyncState> = {}): DeskSyncState {
  return { ...EMPTY_DESK_SYNC_STATE, seeded: true, ...overrides };
}

describe("partitionDeskWorkspaces", () => {
  it("puts every workspace in exactly one of pinned / desk / shelf", () => {
    const workspaces = ["a", "b", "c", "d"].map((key) => ({ workspaceKey: key }));
    const result = partitionDeskWorkspaces({
      workspaces,
      pinnedKeys: new Set(["a", "b"]),
      deskKeys: new Set(["b", "c"]),
    });
    expect(result.pinned.map((w) => w.workspaceKey)).toEqual(["a", "b"]);
    expect(result.desk.map((w) => w.workspaceKey)).toEqual(["c"]);
    expect(result.shelf.map((w) => w.workspaceKey)).toEqual(["d"]);
  });

  it("never shows a pinned workspace in the Desk even when it is marked", () => {
    const result = partitionDeskWorkspaces({
      workspaces: [{ workspaceKey: "x" }],
      pinnedKeys: new Set(["x"]),
      deskKeys: new Set(["x"]),
    });
    expect(result.desk).toEqual([]);
    expect(result.pinned).toHaveLength(1);
  });
});

describe("splitDeskFromProjects", () => {
  it("moves Desk workspaces out of their projects and counts what stays on the Shelf", () => {
    const projects = [
      project("p1", [placement("s", "a"), placement("s", "b")]),
      project("p2", [placement("s", "c")]),
    ];
    const result = splitDeskFromProjects(projects, new Set(["s:b", "s:c"]));
    expect(result.deskPlacements.map((w) => w.workspaceKey)).toEqual(["s:b", "s:c"]);
    expect(result.shelfProjects.map((p) => p.workspaces.map((w) => w.workspaceKey))).toEqual([
      ["s:a"],
      [],
    ]);
    expect(result.shelfCount).toBe(1);
  });

  it("returns the same array when the Desk is empty so memoised consumers do not churn", () => {
    const projects = [project("p1", [placement("s", "a")])];
    const result = splitDeskFromProjects(projects, new Set());
    expect(result.shelfProjects).toBe(projects);
    expect(result.shelfCount).toBe(1);
  });
});

describe("desk rows and grouping", () => {
  const entries = new Map(
    [
      entry("s", "old", { statusEnteredAt: new Date(NOW - 5 * HOUR), projectViewKey: "p1" }),
      entry("s", "new", { statusEnteredAt: new Date(NOW - HOUR), projectViewKey: "p2" }),
      entry("s", "mid", {
        statusEnteredAt: new Date(NOW - 2 * HOUR),
        projectViewKey: "p1",
        statusBucket: "running",
      }),
    ].map((e) => [e.workspaceKey, e]),
  );
  const names = new Map([
    ["p1", "Alpha"],
    ["p2", "Beta"],
  ]);
  const rows = buildDeskRows({
    deskPlacements: [placement("s", "old"), placement("s", "new"), placement("s", "mid")],
    workspaceEntriesByKey: entries,
  });

  it("orders Desk rows by latest activity first", () => {
    expect(rows.map((r) => r.workspaceKey)).toEqual(["s:new", "s:mid", "s:old"]);
  });

  it("skips placements that have no hydrated entry", () => {
    expect(
      buildDeskRows({
        deskPlacements: [placement("s", "ghost"), placement("s", "new")],
        workspaceEntriesByKey: entries,
      }).map((r) => r.workspaceKey),
    ).toEqual(["s:new"]);
  });

  it("Recent is one flat group with no header", () => {
    const groups = buildDeskGroups({ rows, grouping: "recent", projectNamesByViewKey: names });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeNull();
  });

  it("Project groups by project, freshest project first, rows still recent-first", () => {
    const groups = buildDeskGroups({ rows, grouping: "project", projectNamesByViewKey: names });
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.workspaceKey)])).toEqual([
      ["Beta", ["s:new"]],
      ["Alpha", ["s:mid", "s:old"]],
    ]);
  });

  it("Status uses the sidebar's status groups", () => {
    const groups = buildDeskGroups({ rows, grouping: "status", projectNamesByViewKey: names });
    expect(groups.map((g) => g.bucket)).toEqual(["running", "done"]);
    expect(flattenDeskGroups(groups).map((r) => r.workspaceKey)).toEqual([
      "s:mid",
      "s:new",
      "s:old",
    ]);
  });

  it("an empty Desk has no groups", () => {
    expect(buildDeskGroups({ rows: [], grouping: "status", projectNamesByViewKey: names })).toEqual(
      [],
    );
  });
});

describe("pickDeskSeed", () => {
  it("takes non-pinned workspaces that are not Done, plus Done ones active in the last 48h", () => {
    const seed = pickDeskSeed({
      now: NOW,
      workspaces: [
        fact("s", "running", { statusBucket: "running" }),
        fact("s", "attention", { statusBucket: "attention" }),
        fact("s", "needs", { statusBucket: "needs_input" }),
        fact("s", "recent-done", { statusEnteredAt: new Date(NOW - 47 * HOUR) }),
        fact("s", "old-done", { statusEnteredAt: new Date(NOW - 49 * HOUR) }),
        fact("s", "never-done", { statusEnteredAt: null }),
        fact("s", "pinned", { statusBucket: "running", pinned: true }),
      ],
    });
    expect(seed.sort()).toEqual(["s:attention", "s:needs", "s:recent-done", "s:running"]);
  });

  it("caps at 12, keeping the freshest", () => {
    const workspaces = Array.from({ length: 20 }, (_, index) =>
      fact("s", `w${index}`, {
        statusBucket: "running",
        statusEnteredAt: new Date(NOW - index * HOUR),
      }),
    );
    const seed = pickDeskSeed({ now: NOW, workspaces });
    expect(seed).toHaveLength(DESK_SEED_LIMIT);
    expect(seed[0]).toBe("s:w0");
    expect(seed).not.toContain("s:w12");
  });
});

describe("reconcileDesk", () => {
  it("waits until some host has loaded", () => {
    const state = EMPTY_DESK_SYNC_STATE;
    expect(reconcileDesk({ state, workspaces: [], loadedServerIds: new Set(), now: NOW })).toBe(
      state,
    );
  });

  it("seeds once: the live subset goes on the Desk, every key is marked seen", () => {
    const next = reconcileDesk({
      state: EMPTY_DESK_SYNC_STATE,
      workspaces: [
        fact("s", "live", { statusBucket: "running" }),
        fact("s", "quiet", { statusBucket: "done" }),
      ],
      loadedServerIds: new Set(["s"]),
      now: NOW,
    });
    expect(next.seeded).toBe(true);
    expect(next.deskKeys).toEqual(["s:live"]);
    expect([...next.seenKeys].sort()).toEqual(["s:live", "s:quiet"]);
    expect(next.seenHosts).toEqual(["s"]);
  });

  it("puts a workspace that appears after the seed on the Desk", () => {
    const state = seededState({
      seenKeys: ["s:a"],
      seenHosts: ["s"],
    });
    const next = reconcileDesk({
      state,
      workspaces: [fact("s", "a"), fact("s", "fresh")],
      loadedServerIds: new Set(["s"]),
      now: NOW,
    });
    expect(next.deskKeys).toEqual(["s:fresh"]);
    expect(next.seenKeys).toContain("s:fresh");
  });

  it("does not re-add a workspace the user already took off the Desk", () => {
    const state = seededState({ seenKeys: ["s:a"], seenHosts: ["s"], deskKeys: [] });
    const next = reconcileDesk({
      state,
      workspaces: [fact("s", "a")],
      loadedServerIds: new Set(["s"]),
      now: NOW,
    });
    expect(next).toBe(state);
  });

  it("a host that connects late is baselined, never treated as all-new", () => {
    const state = seededState({ seenKeys: ["a:1"], seenHosts: ["a"], deskKeys: ["a:1"] });
    const next = reconcileDesk({
      state,
      workspaces: [fact("a", "1"), fact("b", "1"), fact("b", "2"), fact("b", "3")],
      loadedServerIds: new Set(["a", "b"]),
      now: NOW,
    });
    expect(next.deskKeys).toEqual(["a:1"]);
    expect([...next.seenHosts].sort()).toEqual(["a", "b"]);
    expect(next.seenKeys).toEqual(expect.arrayContaining(["b:1", "b:2", "b:3"]));

    const later = reconcileDesk({
      state: next,
      workspaces: [fact("a", "1"), fact("b", "1"), fact("b", "2"), fact("b", "3"), fact("b", "4")],
      loadedServerIds: new Set(["a", "b"]),
      now: NOW,
    });
    expect(later.deskKeys).toEqual(["a:1", "b:4"]);
  });

  it("a baselined host that loads empty then gains a workspace counts that one as new", () => {
    const first = reconcileDesk({
      state: seededState({ seenHosts: ["a"] }),
      workspaces: [],
      loadedServerIds: new Set(["a", "b"]),
      now: NOW,
    });
    expect([...first.seenHosts].sort()).toEqual(["a", "b"]);
    const second = reconcileDesk({
      state: first,
      workspaces: [fact("b", "1")],
      loadedServerIds: new Set(["a", "b"]),
      now: NOW,
    });
    expect(second.deskKeys).toEqual(["b:1"]);
  });

  it("keeps a workspace that drops out for a moment in its section, never re-adding it as new", () => {
    const state = seededState({
      deskKeys: ["a:desk"],
      seenKeys: ["a:desk", "a:shelf"],
      seenHosts: ["a"],
    });
    const gone = reconcileDesk({
      state,
      workspaces: [fact("a", "other")],
      loadedServerIds: new Set(["a"]),
      now: NOW,
    });
    expect(gone.deskKeys).toEqual(["a:desk", "a:other"]);
    const back = reconcileDesk({
      state: gone,
      workspaces: [fact("a", "desk"), fact("a", "shelf"), fact("a", "other")],
      loadedServerIds: new Set(["a"]),
      now: NOW,
    });
    expect(back).toBe(gone);
    expect(back.deskKeys).not.toContain("a:shelf");
  });

  it("leaves a loaded host's Desk alone while its list is empty", () => {
    const state = seededState({ deskKeys: ["a:1"], seenKeys: ["a:1"], seenHosts: ["a"] });
    expect(
      reconcileDesk({ state, workspaces: [], loadedServerIds: new Set(["a"]), now: NOW }),
    ).toBe(state);
  });

  it("returns the same state object when nothing changed", () => {
    const state = seededState({ deskKeys: ["a:1"], seenKeys: ["a:1"], seenHosts: ["a"] });
    expect(
      reconcileDesk({
        state,
        workspaces: [fact("a", "1")],
        loadedServerIds: new Set(["a"]),
        now: NOW,
      }),
    ).toBe(state);
  });
});

describe("selectClearableDeskKeys", () => {
  it("keeps only Done workspaces", () => {
    expect(
      selectClearableDeskKeys({
        deskKeys: ["s:a", "s:b", "s:c", "s:missing"],
        statusBucketByKey: new Map([
          ["s:a", "done"],
          ["s:b", "running"],
          ["s:c", "done"],
        ]),
      }),
    ).toEqual(["s:a", "s:c"]);
  });
});

describe("orderKeysDeskFirst", () => {
  const keys = ["cur", "left", "n1", "d1", "n2", "d2"];
  const desk = new Set(["d1", "d2", "left"]);

  it("keeps row 0 and the workspace just left, then Desk before the rest, each in MRU order", () => {
    expect(orderKeysDeskFirst(keys, desk, 2)).toEqual(["cur", "left", "d1", "d2", "n1", "n2"]);
  });

  it("keeps only row 0 in place when off a workspace route", () => {
    expect(orderKeysDeskFirst(["left", "n1", "d1"], new Set(["d1"]), 1)).toEqual([
      "left",
      "d1",
      "n1",
    ]);
  });

  it("is the identity when the Desk is empty", () => {
    expect(orderKeysDeskFirst(keys, new Set(), 2)).toBe(keys);
  });

  it("lets Desk workspaces outrank non-Desk ones for the visible cut", () => {
    const history = ["cur", "left", "n1", "n2", "n3"];
    const fallback = ["d-never-visited"];
    const merged = mergeWorkspaceOrder(history, fallback, Number.POSITIVE_INFINITY);
    expect(orderKeysDeskFirst(merged, new Set(["d-never-visited"]), 2).slice(0, 3)).toEqual([
      "cur",
      "left",
      "d-never-visited",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Folder, FoldersSnapshot } from "@getpaseo/protocol/folders";
import {
  activeExplicitFolderKey,
  buildFolderIndex,
  buildFolderPickerOptions,
  buildFolderSections,
  buildFolderShortcutSections,
  daemonItemKey,
  EXPLICIT_FOLDER_TTL_MS,
  folderKeyOfItem,
  formatFolderNameInput,
  parseFolderNameInput,
  pickPreviousPlace,
  planNewWorkspaceFiling,
  UNFILED_FOLDER_KEY,
  type FolderIndex,
} from "@/folders/model";

function folder(id: string, name: string, order: number, emoji: string | null = null): Folder {
  return { id, name, emoji, order, createdAt: `2026-11-0${order + 1}T00:00:00.000Z` };
}

function snapshot(folders: Folder[], membership: Record<string, string> = {}): FoldersSnapshot {
  return { folders, membership };
}

const FAITH = folder("fld_faith", "Faith", 0, "🕌");
const WORK = folder("fld_work", "Work", 1);

function oneHostIndex(membership: Record<string, string> = {}): FolderIndex {
  return buildFolderIndex([{ serverId: "s1", snapshot: snapshot([FAITH, WORK], membership) }]);
}

describe("buildFolderIndex", () => {
  it("lists folders in order and resolves workspace and view membership", () => {
    const index = oneHostIndex({ wks_a: "fld_faith", "board:b1": "fld_work" });
    expect(index.groups.map((group) => group.key)).toEqual(["faith", "work"]);
    expect(index.workspaceFolderKey.get("s1:wks_a")).toBe("faith");
    expect(index.boardFolderKey.get("b1")).toBe("work");
    expect(index.loadedServerIds.has("s1")).toBe(true);
  });

  it("ignores membership that points at a folder the host no longer has", () => {
    const index = oneHostIndex({ wks_a: "fld_gone" });
    expect(index.workspaceFolderKey.size).toBe(0);
  });

  it("merges folders with the same name (any case) across hosts into one group", () => {
    const index = buildFolderIndex([
      { serverId: "s1", snapshot: snapshot([FAITH], { wks_a: "fld_faith" }) },
      {
        serverId: "s2",
        snapshot: snapshot([folder("fld_other", "FAITH", 3), WORK], { wks_b: "fld_other" }),
      },
    ]);
    const faith = index.groups.find((group) => group.key === "faith");
    expect(faith?.members).toEqual([
      { serverId: "s1", folderId: "fld_faith" },
      { serverId: "s2", folderId: "fld_other" },
    ]);
    expect(faith?.name).toBe("Faith");
    expect(index.groups).toHaveLength(2);
    expect(index.workspaceFolderKey.get("s1:wks_a")).toBe("faith");
    expect(index.workspaceFolderKey.get("s2:wks_b")).toBe("faith");
  });

  it("finds the folder of an item, and null for an Unfiled one", () => {
    const index = oneHostIndex({ wks_a: "fld_faith", "board:b1": "fld_work" });
    expect(
      folderKeyOfItem(index, { kind: "workspace", serverId: "s1", workspaceId: "wks_a" }),
    ).toBe("faith");
    expect(folderKeyOfItem(index, { kind: "board", boardId: "b1" })).toBe("work");
    expect(
      folderKeyOfItem(index, { kind: "workspace", serverId: "s1", workspaceId: "wks_z" }),
    ).toBe(null);
  });

  it("keys items for the daemon the way the protocol does", () => {
    expect(daemonItemKey({ kind: "workspace", serverId: "s1", workspaceId: "wks_a" })).toBe(
      "wks_a",
    );
    expect(daemonItemKey({ kind: "board", boardId: "b1" })).toBe("board:b1");
  });
});

describe("buildFolderSections", () => {
  const workspaces = ["s1:wks_a", "s1:wks_b", "s1:wks_c", "s1:wks_d"].map((workspaceKey) => ({
    workspaceKey,
  }));
  const boards = [{ id: "b1" }, { id: "b2" }];

  it("puts every item in exactly one section, Unfiled last, in the order given", () => {
    const index = oneHostIndex({ wks_a: "fld_faith", wks_c: "fld_faith", "board:b1": "fld_work" });
    const sections = buildFolderSections({ index, workspaces, boards });
    expect(sections.map((section) => section.key)).toEqual(["faith", "work", UNFILED_FOLDER_KEY]);
    expect(sections[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["s1:wks_a", "s1:wks_c"]);
    expect(sections[1]?.boards.map((board) => board.id)).toEqual(["b1"]);
    expect(sections[2]?.workspaces.map((w) => w.workspaceKey)).toEqual(["s1:wks_b", "s1:wks_d"]);
    expect(sections[2]?.boards.map((board) => board.id)).toEqual(["b2"]);
    expect(sections.map((section) => section.count)).toEqual([2, 1, 3]);
    expect(sections[2]?.group).toBeNull();
  });

  it("treats a folder the host no longer has as Unfiled and never lists unknown items", () => {
    const index = oneHostIndex({ wks_a: "fld_gone", wks_missing: "fld_faith" });
    const sections = buildFolderSections({ index, workspaces, boards: [] });
    expect(sections[0]?.count).toBe(0);
    expect(sections[sections.length - 1]?.workspaces).toHaveLength(4);
  });

  it("with no folders at all, everything is Unfiled", () => {
    const sections = buildFolderSections({
      index: buildFolderIndex([{ serverId: "s1", snapshot: snapshot([]) }]),
      workspaces,
      boards,
    });
    expect(sections.map((section) => section.key)).toEqual([UNFILED_FOLDER_KEY]);
    expect(sections[0]?.count).toBe(6);
  });

  it("lists a Desk or Pinned workspace in its folder too (the sections do not exclude it)", () => {
    // Desk membership lives elsewhere; the folder sections take the whole workspace list.
    const index = oneHostIndex({ wks_a: "fld_faith" });
    const sections = buildFolderSections({ index, workspaces: workspaces.slice(0, 1), boards: [] });
    expect(sections[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["s1:wks_a"]);
  });
});

describe("buildFolderShortcutSections", () => {
  const sections = [
    { key: "faith", workspaces: [{ workspaceKey: "a" }, { workspaceKey: "b" }] },
    { key: "work", workspaces: [{ workspaceKey: "b" }, { workspaceKey: "c" }] },
    { key: UNFILED_FOLDER_KEY, workspaces: [{ workspaceKey: "d" }] },
  ];
  const keysOf = (built: ReturnType<typeof buildFolderShortcutSections>) =>
    built.map((section) => section.workspaces.map((w) => w.workspaceKey));

  it("numbers only open folders", () => {
    const built = buildFolderShortcutSections({
      sections,
      openKeys: new Set(["work"]),
      sectionCollapsed: false,
      alreadyNumbered: new Set(),
    });
    expect(keysOf(built)).toEqual([[], ["b", "c"], []]);
    expect(built.map((section) => section.collapsed)).toEqual([true, false, true]);
  });

  it("numbers a repeated workspace once, at its first open place", () => {
    const built = buildFolderShortcutSections({
      sections,
      openKeys: new Set(["faith", "work", UNFILED_FOLDER_KEY]),
      sectionCollapsed: false,
      alreadyNumbered: new Set(),
    });
    expect(keysOf(built)).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("skips what Pinned or the Desk already numbered", () => {
    const built = buildFolderShortcutSections({
      sections,
      openKeys: new Set(["faith", "work"]),
      sectionCollapsed: false,
      alreadyNumbered: new Set(["a", "c"]),
    });
    expect(keysOf(built)).toEqual([["b"], [], []]);
  });

  it("numbers a workspace in a later folder when its first place is folded away", () => {
    const built = buildFolderShortcutSections({
      sections,
      openKeys: new Set(["work"]),
      sectionCollapsed: false,
      alreadyNumbered: new Set(),
    });
    expect(keysOf(built)[1]).toEqual(["b", "c"]);
  });

  it("numbers nothing while the whole Folders section is folded", () => {
    const built = buildFolderShortcutSections({
      sections,
      openKeys: new Set(["faith"]),
      sectionCollapsed: true,
      alreadyNumbered: new Set(),
    });
    expect(keysOf(built)).toEqual([[], [], []]);
  });
});

describe("folder name box", () => {
  it("takes a leading emoji as the folder emoji", () => {
    expect(parseFolderNameInput("🕌 Faith")).toEqual({ name: "Faith", emoji: "🕌" });
    expect(parseFolderNameInput("🕌Faith")).toEqual({ name: "Faith", emoji: "🕌" });
    expect(parseFolderNameInput("  Faith  ")).toEqual({ name: "Faith", emoji: null });
    expect(parseFolderNameInput("2026 plans")).toEqual({ name: "2026 plans", emoji: null });
  });

  it("keeps a multi-part emoji whole", () => {
    expect(parseFolderNameInput("👨‍👩‍👧 Family")).toEqual({ name: "Family", emoji: "👨‍👩‍👧" });
    expect(parseFolderNameInput("❤️ Love").emoji).toBe("❤️");
  });

  it("round-trips through the rename box", () => {
    const text = formatFolderNameInput({ name: "Faith", emoji: "🕌" });
    expect(text).toBe("🕌 Faith");
    expect(parseFolderNameInput(text)).toEqual({ name: "Faith", emoji: "🕌" });
    expect(formatFolderNameInput({ name: "Work", emoji: null })).toBe("Work");
  });
});

describe("buildFolderPickerOptions", () => {
  const index = oneHostIndex();
  const base = { groups: index.groups, currentFolderKey: null, unfiledLabel: "Unfiled" };

  it("lists every folder then Unfiled when nothing is typed", () => {
    const options = buildFolderPickerOptions({ ...base, query: "" });
    expect(options.map((option) => option.key)).toEqual(["faith", "work", UNFILED_FOLDER_KEY]);
  });

  it("filters by every typed word, anywhere in the name", () => {
    const groups = buildFolderIndex([
      {
        serverId: "s1",
        snapshot: snapshot([folder("f1", "Deep work", 0), folder("f2", "Faith", 1)]),
      },
    ]).groups;
    const options = buildFolderPickerOptions({ ...base, groups, query: "wor dee" });
    expect(options.filter((option) => option.kind === "folder").map((o) => o.key)).toEqual([
      "deep work",
    ]);
  });

  it("offers Create for a name no folder has, with its emoji", () => {
    const options = buildFolderPickerOptions({ ...base, query: "🌱 Garden" });
    expect(options[options.length - 1]).toEqual({
      kind: "create",
      key: "__create__",
      name: "Garden",
      emoji: "🌱",
    });
  });

  it("does not offer Create for a name a folder already has, any case", () => {
    const options = buildFolderPickerOptions({ ...base, query: "FAITH" });
    expect(options.some((option) => option.kind === "create")).toBe(false);
    expect(options[0]?.key).toBe("faith");
  });

  it("matches Unfiled by its label and marks the current choice", () => {
    const options = buildFolderPickerOptions({ ...base, query: "unf", currentFolderKey: null });
    expect(options[0]).toEqual({ kind: "unfiled", key: UNFILED_FOLDER_KEY, current: true });
    const inFaith = buildFolderPickerOptions({ ...base, query: "", currentFolderKey: "faith" });
    expect(inFaith.find((option) => option.key === "faith")).toMatchObject({ current: true });
    expect(inFaith.find((option) => option.kind === "unfiled")).toMatchObject({ current: false });
  });

  it("has nothing to offer for a query that matches nothing and is only an emoji", () => {
    expect(buildFolderPickerOptions({ ...base, query: "🌱" }).map((o) => o.kind)).toEqual([
      "folder",
      "folder",
      "unfiled",
    ]);
  });
});

describe("new workspace lands where I was", () => {
  const history = [
    { serverId: "s1", workspaceId: "wks_new" },
    { serverId: "s1", workspaceId: "wks_a" },
    { serverId: "board", workspaceId: "b1" },
  ];

  it("takes the most recent place that is not the new workspace itself", () => {
    expect(pickPreviousPlace(history, "s1:wks_new")).toEqual({
      kind: "workspace",
      serverId: "s1",
      workspaceId: "wks_a",
    });
    expect(pickPreviousPlace(history.slice(1), "s1:wks_new")).toEqual({
      kind: "workspace",
      serverId: "s1",
      workspaceId: "wks_a",
    });
    expect(pickPreviousPlace([], "s1:wks_new")).toBeNull();
  });

  it("reads a view visit as a view", () => {
    expect(pickPreviousPlace(history.slice(2), "s1:wks_new")).toEqual({
      kind: "board",
      boardId: "b1",
    });
  });

  it("files a new workspace into the folder of the place before it", () => {
    const index = oneHostIndex({ wks_a: "fld_faith" });
    const { plans, usedExplicit } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index,
      history,
      explicitFolderKey: null,
    });
    expect(plans).toEqual([{ serverId: "s1", workspaceId: "wks_new", folderKey: "faith" }]);
    expect(usedExplicit).toBe(false);
  });

  it("follows a view the user was in", () => {
    const index = oneHostIndex({ "board:b1": "fld_work" });
    const { plans } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index,
      history: [{ serverId: "board", workspaceId: "b1" }],
      explicitFolderKey: null,
    });
    expect(plans[0]?.folderKey).toBe("work");
  });

  it("does nothing when the place before was Unfiled", () => {
    const { plans } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index: oneHostIndex(),
      history,
      explicitFolderKey: null,
    });
    expect(plans).toEqual([]);
  });

  it("skips a workspace that already has a folder (agent-created ones are filed by the daemon)", () => {
    const index = oneHostIndex({ wks_a: "fld_faith", wks_new: "fld_work" });
    const { plans } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index,
      history,
      explicitFolderKey: "faith",
    });
    expect(plans).toEqual([]);
  });

  it("skips a host whose folders have not loaded: not knowing is not Unfiled", () => {
    const index = oneHostIndex({ wks_a: "fld_faith" });
    const { plans } = planNewWorkspaceFiling({
      landedKeys: ["s9:wks_new"],
      index,
      history: [{ serverId: "s9", workspaceId: "wks_a" }],
      explicitFolderKey: null,
    });
    expect(plans).toEqual([]);
  });

  it("an explicit + on a folder wins over where I was, and reports it was used", () => {
    const index = oneHostIndex({ wks_a: "fld_faith" });
    const { plans, usedExplicit } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index,
      history,
      explicitFolderKey: "work",
    });
    expect(plans).toEqual([{ serverId: "s1", workspaceId: "wks_new", folderKey: "work" }]);
    expect(usedExplicit).toBe(true);
  });

  it("ignores an explicit folder that was deleted since", () => {
    const { plans } = planNewWorkspaceFiling({
      landedKeys: ["s1:wks_new"],
      index: oneHostIndex(),
      history,
      explicitFolderKey: "gone",
    });
    expect(plans).toEqual([]);
  });

  it("an explicit choice expires", () => {
    const now = 1_000_000;
    const choice = { folderKey: "faith", at: now };
    expect(activeExplicitFolderKey(choice, now + EXPLICIT_FOLDER_TTL_MS)).toBe("faith");
    expect(activeExplicitFolderKey(choice, now + EXPLICIT_FOLDER_TTL_MS + 1)).toBeNull();
    expect(activeExplicitFolderKey(null, now)).toBeNull();
  });
});

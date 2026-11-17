import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoldersSnapshot } from "@getpaseo/protocol/folders";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createFolderRegistry, FileBackedFolderRegistry, FolderError } from "./folder-registry.js";

const logger = createTestLogger();

let home: string;
let registry: FileBackedFolderRegistry;

function filePath(): string {
  return path.join(home, "projects", "folders.json");
}

function reopen(): FileBackedFolderRegistry {
  return createFolderRegistry(home, logger);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "paseo-folders-"));
  registry = createFolderRegistry(home, logger);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("FileBackedFolderRegistry folders", () => {
  it("starts empty and creates folders with fld_ ids in order", async () => {
    expect(await registry.getSnapshot()).toEqual({ folders: [], membership: {} });

    const faith = await registry.createFolder({ name: "  Faith ", emoji: " 🕌 " });
    const work = await registry.createFolder({ name: "Work" });

    expect(faith).toMatchObject({ name: "Faith", emoji: "🕌", order: 0 });
    expect(faith.id).toMatch(/^fld_[0-9a-f]{16}$/);
    expect(work).toMatchObject({ name: "Work", emoji: null, order: 1 });
    expect((await registry.getSnapshot()).folders.map((folder) => folder.name)).toEqual([
      "Faith",
      "Work",
    ]);
  });

  it("honours an explicit order", async () => {
    await registry.createFolder({ name: "B", order: 5 });
    await registry.createFolder({ name: "A", order: -1 });

    expect((await registry.getSnapshot()).folders.map((folder) => folder.name)).toEqual(["A", "B"]);
  });

  it("rejects empty and duplicate names, ignoring case and padding", async () => {
    await registry.createFolder({ name: "Faith" });

    expect(await rejection(registry.createFolder({ name: "   " }))).toMatchObject({
      code: "invalid",
    });
    expect(await rejection(registry.createFolder({ name: " fAiTh " }))).toMatchObject({
      code: "duplicate_name",
    });
    expect(await rejection(registry.createFolder({ name: "x".repeat(81) }))).toBeInstanceOf(
      FolderError,
    );
    expect((await registry.getSnapshot()).folders).toHaveLength(1);
  });

  it("renames, re-emojis and clears the emoji without touching the rest", async () => {
    const folder = await registry.createFolder({ name: "Faith", emoji: "🕌" });
    const other = await registry.createFolder({ name: "Work" });

    const renamed = await registry.updateFolder({ folderId: folder.id, name: "Deen" });
    expect(renamed).toMatchObject({ id: folder.id, name: "Deen", emoji: "🕌" });
    const cleared = await registry.updateFolder({ folderId: folder.id, emoji: null });
    expect(cleared.emoji).toBeNull();

    expect(
      await rejection(registry.updateFolder({ folderId: other.id, name: "deen" })),
    ).toMatchObject({ code: "duplicate_name" });
    // Keeping your own name, in another case, is not a clash.
    expect((await registry.updateFolder({ folderId: other.id, name: "WORK" })).name).toBe("WORK");
    expect(
      await rejection(registry.updateFolder({ folderId: "fld_missing", name: "X" })),
    ).toMatchObject({ code: "not_found" });
  });

  it("reorders: listed first in the given order, the rest keep their order after them", async () => {
    const a = await registry.createFolder({ name: "A" });
    const b = await registry.createFolder({ name: "B" });
    const c = await registry.createFolder({ name: "C" });

    const reordered = await registry.reorderFolders([c.id, a.id]);
    expect(reordered.map((folder) => folder.name)).toEqual(["C", "A", "B"]);
    expect(reordered.map((folder) => folder.order)).toEqual([0, 1, 2]);
    expect(await rejection(registry.reorderFolders([b.id, "fld_missing"]))).toMatchObject({
      code: "not_found",
    });
    // The failed call changed nothing.
    expect((await registry.getSnapshot()).folders.map((folder) => folder.name)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });
});

describe("FileBackedFolderRegistry membership", () => {
  it("files workspaces and views, moves them, and sends them to Unfiled with null", async () => {
    const faith = await registry.createFolder({ name: "Faith" });
    const work = await registry.createFolder({ name: "Work" });

    expect(await registry.assignItems(["wks_1", " board:b1 ", "wks_1"], faith.id)).toEqual([
      "wks_1",
      "board:b1",
    ]);
    expect((await registry.getSnapshot()).membership).toEqual({
      wks_1: faith.id,
      "board:b1": faith.id,
    });

    await registry.assignItems(["wks_1"], work.id);
    expect((await registry.getSnapshot()).membership.wks_1).toBe(work.id);

    await registry.assignItems(["wks_1", "wks_never_filed"], null);
    expect((await registry.getSnapshot()).membership).toEqual({ "board:b1": faith.id });
  });

  it("rejects an unknown folder and an empty item key without changing anything", async () => {
    const faith = await registry.createFolder({ name: "Faith" });
    await registry.assignItems(["wks_1"], faith.id);

    expect(await rejection(registry.assignItems(["wks_2"], "fld_missing"))).toMatchObject({
      code: "not_found",
    });
    expect(await rejection(registry.assignItems(["wks_2", "  "], faith.id))).toMatchObject({
      code: "invalid",
    });
    expect((await registry.getSnapshot()).membership).toEqual({ wks_1: faith.id });
  });

  it("delete removes the folder and returns the released item keys", async () => {
    const faith = await registry.createFolder({ name: "Faith" });
    const work = await registry.createFolder({ name: "Work" });
    await registry.assignItems(["wks_b", "wks_a", "board:x"], faith.id);
    await registry.assignItems(["wks_c"], work.id);

    const deleted = await registry.deleteFolder(faith.id);

    expect(deleted.folder.id).toBe(faith.id);
    expect(deleted.releasedItemKeys).toEqual(["board:x", "wks_a", "wks_b"]);
    expect(await registry.getSnapshot()).toMatchObject({
      folders: [{ id: work.id }],
      membership: { wks_c: work.id },
    });
    expect(await rejection(registry.deleteFolder(faith.id))).toMatchObject({ code: "not_found" });
  });

  it("a new item inherits the source item's folder, and only when the source has one", async () => {
    const faith = await registry.createFolder({ name: "Faith" });
    await registry.assignItems(["wks_parent"], faith.id);

    expect(await registry.inheritFolder("wks_child", "wks_parent")).toBe(faith.id);
    expect(await registry.inheritFolder("wks_orphan", "wks_unfiled")).toBeNull();

    expect((await registry.getSnapshot()).membership).toEqual({
      wks_parent: faith.id,
      wks_child: faith.id,
    });
  });
});

describe("FileBackedFolderRegistry persistence", () => {
  it("round-trips through folders.json", async () => {
    const faith = await registry.createFolder({ name: "Faith", emoji: "🕌" });
    const work = await registry.createFolder({ name: "Work" });
    await registry.assignItems(["wks_1", "board:b1"], faith.id);
    await registry.assignItems(["wks_2"], work.id);
    const before = await registry.getSnapshot();

    expect(await reopen().getSnapshot()).toEqual(before);
  });

  it("writes a readable array: folders by order, then members by key", async () => {
    const faith = await registry.createFolder({ name: "Faith", emoji: "🕌" });
    await registry.assignItems(["wks_b"], faith.id);
    await registry.createFolder({ name: "Work" });
    await registry.assignItems(["wks_a"], faith.id);

    const onDisk = JSON.parse(readFileSync(filePath(), "utf8")) as Array<Record<string, unknown>>;

    expect(onDisk.map((record) => record.kind)).toEqual(["folder", "folder", "member", "member"]);
    expect(onDisk[0]).toMatchObject({ kind: "folder", id: faith.id, name: "Faith", emoji: "🕌" });
    expect(onDisk.slice(2)).toEqual([
      { kind: "member", itemKey: "wks_a", folderId: faith.id },
      { kind: "member", itemKey: "wks_b", folderId: faith.id },
    ]);
  });

  it("serialises concurrent changes without losing any", async () => {
    const faith = await registry.createFolder({ name: "Faith" });

    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        registry.assignItems([`wks_${index}`], faith.id),
      ),
    );

    expect(Object.keys((await reopen().getSnapshot()).membership)).toHaveLength(20);
  });
});

describe("FileBackedFolderRegistry change feed", () => {
  it("pushes the full state after each change, and nothing for a no-op or a failure", async () => {
    const seen: FoldersSnapshot[] = [];
    const unsubscribe = registry.subscribeToChanges((snapshot) => {
      seen.push(snapshot);
    });

    const faith = await registry.createFolder({ name: "Faith" });
    await registry.assignItems(["wks_1"], faith.id);
    await registry.assignItems(["wks_1"], faith.id);
    await registry.updateFolder({ folderId: faith.id, name: "Faith" });
    await rejection(registry.createFolder({ name: "faith" }));
    await registry.assignItems(["wks_1"], null);

    expect(seen).toHaveLength(3);
    expect(seen[1]).toEqual({ folders: [faith], membership: { wks_1: faith.id } });
    expect(seen[2]?.membership).toEqual({});

    unsubscribe();
    await registry.createFolder({ name: "Work" });
    expect(seen).toHaveLength(3);
  });

  it("a failing listener does not stop the others or the change", async () => {
    const seen: number[] = [];
    registry.subscribeToChanges(() => {
      throw new Error("boom");
    });
    registry.subscribeToChanges((snapshot) => {
      seen.push(snapshot.folders.length);
    });

    await registry.createFolder({ name: "Faith" });

    expect(seen).toEqual([1]);
    expect((await registry.getSnapshot()).folders).toHaveLength(1);
  });
});

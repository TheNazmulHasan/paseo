import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder } from "@getpaseo/protocol/folders";

const clients = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: (serverId: string) => clients.get(serverId) ?? null }),
}));

import {
  createFolderAndFile,
  deleteFolderGroup,
  fileItem,
  FolderHostUnavailableError,
  renameFolderGroup,
  restoreDeletedFolder,
} from "@/folders/actions";
import { buildIndexFromSnapshots, useFolderStore } from "@/folders/folder-store";
import { useFolderUiStore } from "@/folders/folder-ui-store";

function folder(id: string, name: string, order: number, emoji: string | null = null): Folder {
  return { id, name, emoji, order, createdAt: "2026-11-01T00:00:00.000Z" };
}

function fakeClient() {
  return {
    createFolder: vi.fn(async (input: { name: string; emoji?: string | null; order?: number }) =>
      folder(`fld_new_${input.name}`, input.name, input.order ?? 9, input.emoji ?? null),
    ),
    updateFolder: vi.fn(async (input: { folderId: string; name?: string }) =>
      folder(input.folderId, input.name ?? "x", 0),
    ),
    deleteFolder: vi.fn(async (folderId: string) => ({
      folder: folder(folderId, "Faith", 3, "🕌"),
      releasedItemKeys: ["wks_a", "board:b1"],
    })),
    assignToFolder: vi.fn(async (itemKeys: string[], folderId: string | null) => ({
      itemKeys,
      folderId,
    })),
  };
}

const FAITH = folder("fld_faith", "Faith", 3, "🕌");

function loadHost(serverId: string, folders: Folder[]) {
  useFolderStore.getState().setSnapshot(serverId, { folders, membership: {} });
}

function groupOf(key: string) {
  const group = buildIndexFromSnapshots(useFolderStore.getState().snapshots).groups.find(
    (candidate) => candidate.key === key,
  );
  if (!group) throw new Error(`no group ${key}`);
  return group;
}

describe("folder actions", () => {
  let client: ReturnType<typeof fakeClient>;

  beforeEach(() => {
    clients.clear();
    client = fakeClient();
    clients.set("s1", client);
    useFolderStore.setState({ snapshots: {}, creating: false, explicitFolder: null });
    useFolderUiStore.setState({ sectionCollapsed: false, openKeys: [] });
    loadHost("s1", [FAITH]);
  });

  it("files a workspace under its own id and a view under board:<id>", async () => {
    await fileItem({ kind: "workspace", serverId: "s1", workspaceId: "wks_a" }, "faith");
    expect(client.assignToFolder).toHaveBeenLastCalledWith(["wks_a"], "fld_faith");
    await fileItem({ kind: "board", boardId: "b1" }, "faith");
    expect(client.assignToFolder).toHaveBeenLastCalledWith(["board:b1"], "fld_faith");
  });

  it("takes an item out of its folder with a null folder id", async () => {
    await fileItem({ kind: "workspace", serverId: "s1", workspaceId: "wks_a" }, null);
    expect(client.assignToFolder).toHaveBeenCalledWith(["wks_a"], null);
  });

  it("creates the folder on a host that lacks it before filing there", async () => {
    const other = fakeClient();
    clients.set("s2", other);
    loadHost("s2", []);
    await fileItem({ kind: "workspace", serverId: "s2", workspaceId: "wks_b" }, "faith");
    expect(other.createFolder).toHaveBeenCalledWith({ name: "Faith", emoji: "🕌" });
    expect(other.assignToFolder).toHaveBeenCalledWith(["wks_b"], "fld_new_Faith");
  });

  it("refuses an item whose host has no folders loaded", async () => {
    await expect(
      fileItem({ kind: "workspace", serverId: "s9", workspaceId: "wks_a" }, "faith"),
    ).rejects.toBeInstanceOf(FolderHostUnavailableError);
  });

  it("creates a folder from the one box and files the item into it", async () => {
    const key = await createFolderAndFile(
      { kind: "workspace", serverId: "s1", workspaceId: "wks_a" },
      "🌱 Garden",
    );
    expect(key).toBe("garden");
    expect(client.createFolder).toHaveBeenCalledWith({ name: "Garden", emoji: "🌱" });
    expect(client.assignToFolder).toHaveBeenCalledWith(["wks_a"], "fld_new_Garden");
  });

  it("renames with the new emoji and keeps the fold state under the new name", async () => {
    useFolderUiStore.setState({ openKeys: ["faith", "work"] });
    await renameFolderGroup(groupOf("faith"), "📿 Deen");
    expect(client.updateFolder).toHaveBeenCalledWith({
      folderId: "fld_faith",
      name: "Deen",
      emoji: "📿",
    });
    expect(useFolderUiStore.getState().openKeys.sort()).toEqual(["deen", "work"]);
  });

  it("delete releases the items and Undo re-creates the folder with the same name, emoji and order", async () => {
    const record = await deleteFolderGroup(groupOf("faith"));
    expect(client.deleteFolder).toHaveBeenCalledWith("fld_faith");
    expect(record).toEqual({
      name: "Faith",
      emoji: "🕌",
      parts: [{ serverId: "s1", order: 3, releasedItemKeys: ["wks_a", "board:b1"] }],
    });

    await restoreDeletedFolder(record);
    expect(client.createFolder).toHaveBeenCalledWith({ name: "Faith", emoji: "🕌", order: 3 });
    // The re-created folder has a new id; the released items go into it.
    expect(client.assignToFolder).toHaveBeenCalledWith(["wks_a", "board:b1"], "fld_new_Faith");
  });

  it("Undo of a folder that released nothing only re-creates it", async () => {
    await restoreDeletedFolder({
      name: "Empty",
      emoji: null,
      parts: [{ serverId: "s1", order: 1, releasedItemKeys: [] }],
    });
    expect(client.createFolder).toHaveBeenCalledWith({ name: "Empty", emoji: null, order: 1 });
    expect(client.assignToFolder).not.toHaveBeenCalled();
  });

  it("surfaces the daemon's message when every host rejects", async () => {
    client.updateFolder.mockRejectedValueOnce(new Error('A folder named "Work" exists'));
    await expect(renameFolderGroup(groupOf("faith"), "Work")).rejects.toThrow(
      'A folder named "Work" exists',
    );
  });
});

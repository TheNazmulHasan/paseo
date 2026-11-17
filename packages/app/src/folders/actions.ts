import { folderNameKey, type Folder } from "@getpaseo/protocol/folders";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getFolderIndex, useFolderStore } from "@/folders/folder-store";
import { useFolderUiStore } from "@/folders/folder-ui-store";
import {
  daemonItemKey,
  parseFolderNameInput,
  type FolderGroup,
  type FolderItemRef,
} from "@/folders/model";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

/** No connected host holds folders, or the host holding this item is offline. */
export class FolderHostUnavailableError extends Error {
  constructor() {
    super("Folder host unavailable");
    this.name = "FolderHostUnavailableError";
  }
}

function requireClient(serverId: string): DaemonClient {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new FolderHostUnavailableError();
  }
  return client;
}

/** Hosts whose folders have loaded: the ones an item can be filed on. */
export function folderHostIds(): string[] {
  return Object.keys(useFolderStore.getState().snapshots).sort();
}

/** Views live on this device, so their filing sits on the first folder host. */
export function hostOfItem(item: FolderItemRef): string | null {
  if (item.kind === "workspace") {
    return item.serverId in useFolderStore.getState().snapshots ? item.serverId : null;
  }
  return folderHostIds()[0] ?? null;
}

/** First failure when every call failed; partial success counts as success. */
function throwIfAllFailed(results: readonly PromiseSettledResult<unknown>[]): void {
  if (results.length > 0 && results.every((result) => result.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
}

/** Creates the folder on every folder host, so it exists wherever an item may be filed. */
export async function createFolderOnAllHosts(input: {
  name: string;
  emoji: string | null;
}): Promise<Array<{ serverId: string; folder: Folder }>> {
  const serverIds = folderHostIds();
  if (serverIds.length === 0) {
    throw new FolderHostUnavailableError();
  }
  const results = await Promise.allSettled(
    serverIds.map(async (serverId) => ({
      serverId,
      folder: await requireClient(serverId).createFolder({
        name: input.name,
        emoji: input.emoji,
      }),
    })),
  );
  throwIfAllFailed(results);
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

/** Creates a folder from the one-box input ("🕌 Faith"); returns its group key. */
export async function createFolderFromInput(raw: string): Promise<string> {
  const { name, emoji } = parseFolderNameInput(raw);
  await createFolderOnAllHosts({ name, emoji });
  return folderNameKey(name);
}

async function assignOnHost(
  serverId: string,
  itemKeys: readonly string[],
  folderId: string | null,
): Promise<void> {
  await requireClient(serverId).assignToFolder([...itemKeys], folderId);
}

/**
 * Files one item into a folder group (null = Unfiled). A host that does not have the folder yet
 * (it was made while that host was away) gets it created first.
 */
export async function fileItem(item: FolderItemRef, folderKey: string | null): Promise<void> {
  const serverId = hostOfItem(item);
  if (!serverId) {
    throw new FolderHostUnavailableError();
  }
  if (folderKey === null) {
    await assignOnHost(serverId, [daemonItemKey(item)], null);
    return;
  }
  const group = getFolderIndex().groups.find((candidate) => candidate.key === folderKey);
  if (!group) {
    throw new FolderHostUnavailableError();
  }
  const existing = group.members.find((member) => member.serverId === serverId);
  const folderId =
    existing?.folderId ??
    (await requireClient(serverId).createFolder({ name: group.name, emoji: group.emoji })).id;
  await assignOnHost(serverId, [daemonItemKey(item)], folderId);
}

/** Creates the folder from the one-box input and files the item into it. Returns the group key. */
export async function createFolderAndFile(item: FolderItemRef, raw: string): Promise<string> {
  const { name, emoji } = parseFolderNameInput(raw);
  const itemServerId = hostOfItem(item);
  if (!itemServerId) {
    throw new FolderHostUnavailableError();
  }
  const created = await createFolderOnAllHosts({ name, emoji });
  const mine = created.find((entry) => entry.serverId === itemServerId);
  if (!mine) {
    // The folder exists elsewhere but not on this item's host: that call failed, so say so.
    throw new FolderHostUnavailableError();
  }
  await assignOnHost(itemServerId, [daemonItemKey(item)], mine.folder.id);
  return folderNameKey(name);
}

/** Renames and re-emojis every member of the group; the fold state follows the new name. */
export async function renameFolderGroup(group: FolderGroup, raw: string): Promise<void> {
  const { name, emoji } = parseFolderNameInput(raw);
  const results = await Promise.allSettled(
    group.members.map((member) =>
      requireClient(member.serverId).updateFolder({ folderId: member.folderId, name, emoji }),
    ),
  );
  throwIfAllFailed(results);
  useFolderUiStore.getState().renameFolderKey(group.key, folderNameKey(name));
}

export interface DeletedFolderRecord {
  name: string;
  emoji: string | null;
  parts: Array<{ serverId: string; order: number; releasedItemKeys: string[] }>;
}

/** Deletes the group on every host; its items become Unfiled. The record is what Undo needs. */
export async function deleteFolderGroup(group: FolderGroup): Promise<DeletedFolderRecord> {
  const results = await Promise.allSettled(
    group.members.map(async (member) => {
      const deleted = await requireClient(member.serverId).deleteFolder(member.folderId);
      return {
        serverId: member.serverId,
        order: deleted.folder.order,
        releasedItemKeys: deleted.releasedItemKeys,
      };
    }),
  );
  throwIfAllFailed(results);
  return {
    name: group.name,
    emoji: group.emoji,
    parts: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  };
}

/**
 * Undo for a delete: the folder comes back with the same name, emoji and order, and its items go
 * back in. The new folder has a new id, but the UI keys folders by name, so it is the same folder.
 */
export async function restoreDeletedFolder(record: DeletedFolderRecord): Promise<void> {
  const results = await Promise.allSettled(
    record.parts.map(async (part) => {
      const folder = await requireClient(part.serverId).createFolder({
        name: record.name,
        emoji: record.emoji,
        order: part.order,
      });
      if (part.releasedItemKeys.length > 0) {
        await assignOnHost(part.serverId, part.releasedItemKeys, folder.id);
      }
    }),
  );
  throwIfAllFailed(results);
}

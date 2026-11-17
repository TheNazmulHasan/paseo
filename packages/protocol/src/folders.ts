import { z } from "zod";

/**
 * Nazmul mod (folders): user-made folders that hold workspaces and saved views ("boards").
 * One level, no nesting. The daemon owns them so every device shows the same sidebar.
 *
 * Items are addressed by an item key: a workspace's id (`wks_...`) or `board:<boardId>` for a
 * view. An item is in at most one folder; no membership entry means Unfiled, which is a
 * client-side built-in and never stored.
 */
export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().nullable(),
  order: z.number(),
  createdAt: z.string(),
});

/** itemKey -> folderId. */
export const FolderMembershipSchema = z.record(z.string(), z.string());

export const FoldersSnapshotSchema = z.object({
  folders: z.array(FolderSchema),
  membership: FolderMembershipSchema,
});

export type Folder = z.infer<typeof FolderSchema>;
export type FolderMembership = z.infer<typeof FolderMembershipSchema>;
export type FoldersSnapshot = z.infer<typeof FoldersSnapshotSchema>;

export const FOLDER_NAME_MAX_LENGTH = 80;
export const FOLDER_EMOJI_MAX_LENGTH = 16;

const BOARD_ITEM_KEY_PREFIX = "board:";

/** Item key for a saved view. Workspaces use their workspace id as-is. */
export function boardFolderItemKey(boardId: string): string {
  return `${BOARD_ITEM_KEY_PREFIX}${boardId}`;
}

export function isBoardFolderItemKey(itemKey: string): boolean {
  return itemKey.startsWith(BOARD_ITEM_KEY_PREFIX);
}

/** Case-insensitive, trimmed key two folder names are compared by. */
export function folderNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Finds a folder by id, else by name (case-insensitive). Agents and the CLI take either.
 * Returns null when nothing matches.
 */
export function findFolderByRef(folders: readonly Folder[], ref: string): Folder | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const byId = folders.find((folder) => folder.id === trimmed);
  if (byId) return byId;
  const key = folderNameKey(trimmed);
  return folders.find((folder) => folderNameKey(folder.name) === key) ?? null;
}

/** Folders in display order: `order`, then oldest first, then id. */
export function sortFolders<T extends Folder>(folders: readonly T[]): T[] {
  return [...folders].sort(
    (a, b) =>
      a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

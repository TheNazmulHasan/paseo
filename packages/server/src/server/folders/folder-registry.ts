import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { Logger } from "pino";
import { z } from "zod";
import {
  FOLDER_EMOJI_MAX_LENGTH,
  FOLDER_NAME_MAX_LENGTH,
  folderNameKey,
  sortFolders,
  type Folder,
  type FoldersSnapshot,
} from "@getpaseo/protocol/folders";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { FileBackedRegistry } from "../workspace-registry.js";

/**
 * Nazmul mod (folders): the folder store, `<paseoHome>/projects/folders.json`.
 *
 * One flat array, one record per folder and one per filed item, so the file reads as it is:
 *
 *   { "kind": "folder", "id": "fld_...", "name": "Faith", "emoji": "...", "order": 0, ... }
 *   { "kind": "member", "itemKey": "wks_...", "folderId": "fld_..." }
 *
 * Keyed by workspace id (or `board:<id>`), never by path. An item with no member record is
 * Unfiled. Every mutation is one atomic write, so a folder and its members never disagree.
 */
const FolderRecordSchema = z.object({
  kind: z.literal("folder"),
  id: z.string(),
  name: z.string(),
  emoji: z.string().nullable(),
  order: z.number(),
  createdAt: z.string(),
});

const MemberRecordSchema = z.object({
  kind: z.literal("member"),
  itemKey: z.string(),
  folderId: z.string(),
});

const PersistedFolderRecordSchema = z.discriminatedUnion("kind", [
  FolderRecordSchema,
  MemberRecordSchema,
]);

type FolderRecord = z.infer<typeof FolderRecordSchema>;
type MemberRecord = z.infer<typeof MemberRecordSchema>;
export type PersistedFolderRecord = FolderRecord | MemberRecord;
type RecordMap = Map<string, PersistedFolderRecord>;

export type FolderErrorCode = "invalid" | "duplicate_name" | "not_found";

/** A request the caller got wrong. The message is safe to show to a user or an agent. */
export class FolderError extends Error {
  constructor(
    readonly code: FolderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FolderError";
  }
}

export type FoldersChangeListener = (snapshot: FoldersSnapshot) => void | Promise<void>;

const folderKey = (folderId: string): string => `folder:${folderId}`;
const memberKey = (itemKey: string): string => `member:${itemKey}`;
const recordKey = (record: PersistedFolderRecord): string =>
  record.kind === "folder" ? folderKey(record.id) : memberKey(record.itemKey);

function toFolder(record: FolderRecord): Folder {
  return {
    id: record.id,
    name: record.name,
    emoji: record.emoji,
    order: record.order,
    createdAt: record.createdAt,
  };
}

function folderRecords(records: RecordMap): FolderRecord[] {
  const folders: FolderRecord[] = [];
  for (const record of records.values()) if (record.kind === "folder") folders.push(record);
  return folders;
}

function memberRecords(records: RecordMap): MemberRecord[] {
  const members: MemberRecord[] = [];
  for (const record of records.values()) if (record.kind === "member") members.push(record);
  return members;
}

function toSnapshot(records: RecordMap): FoldersSnapshot {
  const membership: Record<string, string> = {};
  for (const member of memberRecords(records)) membership[member.itemKey] = member.folderId;
  return { folders: sortFolders(folderRecords(records).map(toFolder)), membership };
}

function requireFolder(records: RecordMap, folderId: string): FolderRecord {
  const record = records.get(folderKey(folderId));
  if (!record || record.kind !== "folder") {
    throw new FolderError("not_found", `Folder ${folderId} not found`);
  }
  return record;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new FolderError("invalid", "Folder name cannot be empty");
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
    throw new FolderError("invalid", `Folder name is longer than ${FOLDER_NAME_MAX_LENGTH}`);
  }
  return trimmed;
}

function normalizeEmoji(emoji: string | null | undefined): string | null {
  const trimmed = emoji?.trim() ?? "";
  if (trimmed.length > FOLDER_EMOJI_MAX_LENGTH) {
    throw new FolderError("invalid", `Folder emoji is longer than ${FOLDER_EMOJI_MAX_LENGTH}`);
  }
  return trimmed || null;
}

function assertNameFree(records: RecordMap, name: string, exceptFolderId?: string): void {
  const key = folderNameKey(name);
  const taken = folderRecords(records).find(
    (folder) => folder.id !== exceptFolderId && folderNameKey(folder.name) === key,
  );
  if (taken) throw new FolderError("duplicate_name", `A folder named "${taken.name}" exists`);
}

function normalizeItemKeys(itemKeys: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const itemKey of itemKeys) {
    const trimmed = itemKey.trim();
    if (!trimmed) throw new FolderError("invalid", "Item key cannot be empty");
    keys.add(trimmed);
  }
  return [...keys];
}

/** Folders first (by order), then members by item key: a stable, diff-friendly file. */
function sortForDisk(records: readonly PersistedFolderRecord[]): PersistedFolderRecord[] {
  const folders = sortFolders(records.filter((record) => record.kind === "folder"));
  const members = records
    .filter((record) => record.kind === "member")
    .sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  return [...folders, ...members];
}

export class FileBackedFolderRegistry extends FileBackedRegistry<PersistedFolderRecord> {
  private readonly listeners = new Set<FoldersChangeListener>();
  private readonly changeLogger: Logger;

  constructor(
    filePath: string,
    logger: Logger,
    options?: {
      writeRecords?: (filePath: string, records: readonly PersistedFolderRecord[]) => Promise<void>;
    },
  ) {
    const writeRecords = options?.writeRecords ?? writeJsonFileAtomic;
    super({
      filePath,
      logger,
      schema: PersistedFolderRecordSchema,
      getId: recordKey,
      component: "folders",
      writeRecords: (path, records) => writeRecords(path, sortForDisk(records)),
    });
    this.changeLogger = logger.child({ module: "folders" });
  }

  async getSnapshot(): Promise<FoldersSnapshot> {
    return toSnapshot(new Map((await this.list()).map((record) => [recordKey(record), record])));
  }

  /** Calls the listener with the full state after every change. Returns the unsubscribe. */
  subscribeToChanges(listener: FoldersChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createFolder(input: {
    name: string;
    emoji?: string | null;
    order?: number;
    now?: Date;
  }): Promise<Folder> {
    const name = normalizeName(input.name);
    const emoji = normalizeEmoji(input.emoji);
    return this.mutate((records) => {
      assertNameFree(records, name);
      let id = newFolderId();
      while (records.has(folderKey(id))) id = newFolderId();
      const orders = folderRecords(records).map((folder) => folder.order);
      const record: FolderRecord = {
        kind: "folder",
        id,
        name,
        emoji,
        order: input.order ?? (orders.length > 0 ? Math.max(...orders) + 1 : 0),
        createdAt: (input.now ?? new Date()).toISOString(),
      };
      records.set(folderKey(id), record);
      return toFolder(record);
    });
  }

  async updateFolder(input: {
    folderId: string;
    name?: string;
    emoji?: string | null;
  }): Promise<Folder> {
    const name = input.name === undefined ? undefined : normalizeName(input.name);
    const emoji = input.emoji === undefined ? undefined : normalizeEmoji(input.emoji);
    return this.mutate((records) => {
      const existing = requireFolder(records, input.folderId);
      if (name !== undefined) assertNameFree(records, name, existing.id);
      const next: FolderRecord = {
        ...existing,
        name: name ?? existing.name,
        emoji: emoji === undefined ? existing.emoji : emoji,
      };
      if (next.name === existing.name && next.emoji === existing.emoji) return toFolder(existing);
      records.set(folderKey(existing.id), next);
      return toFolder(next);
    });
  }

  /** Removes the folder. Its items go to Unfiled; their keys come back so a caller can undo. */
  async deleteFolder(folderId: string): Promise<{ folder: Folder; releasedItemKeys: string[] }> {
    return this.mutate((records) => {
      const existing = requireFolder(records, folderId);
      const released = memberRecords(records)
        .filter((member) => member.folderId === folderId)
        .map((member) => member.itemKey)
        .sort();
      records.delete(folderKey(folderId));
      for (const itemKey of released) records.delete(memberKey(itemKey));
      return { folder: toFolder(existing), releasedItemKeys: released };
    });
  }

  /**
   * Sets the display order. Folders named in `folderIds` come first in that order; folders left
   * out (made on another device a moment ago) keep their relative order after them.
   */
  async reorderFolders(folderIds: readonly string[]): Promise<Folder[]> {
    return this.mutate((records) => {
      const listed: FolderRecord[] = [];
      for (const folderId of new Set(folderIds)) listed.push(requireFolder(records, folderId));
      const listedIds = new Set(listed.map((folder) => folder.id));
      const rest = sortFolders(
        folderRecords(records)
          .filter((folder) => !listedIds.has(folder.id))
          .map(toFolder),
      );
      const ordered = [...listed.map((folder) => folder.id), ...rest.map((folder) => folder.id)];
      ordered.forEach((id, index) => {
        const folder = requireFolder(records, id);
        if (folder.order !== index) records.set(folderKey(id), { ...folder, order: index });
      });
      return sortFolders(folderRecords(records).map(toFolder));
    });
  }

  /** Files items into a folder, or into Unfiled when `folderId` is null. Returns the item keys. */
  async assignItems(itemKeys: readonly string[], folderId: string | null): Promise<string[]> {
    const keys = normalizeItemKeys(itemKeys);
    return this.mutate((records) => {
      if (folderId !== null) requireFolder(records, folderId);
      for (const itemKey of keys) {
        if (folderId === null) records.delete(memberKey(itemKey));
        else if (
          (records.get(memberKey(itemKey)) as MemberRecord | undefined)?.folderId !== folderId
        )
          records.set(memberKey(itemKey), { kind: "member", itemKey, folderId });
      }
      return keys;
    });
  }

  /**
   * A new item lands in the folder of the item that made it (an agent's workspace goes where the
   * agent's own workspace is). Does nothing when the source is Unfiled. Returns the folder id.
   */
  async inheritFolder(newItemKey: string, sourceItemKey: string): Promise<string | null> {
    return this.mutate((records) => {
      const source = records.get(memberKey(sourceItemKey)) as MemberRecord | undefined;
      if (!source || !records.has(folderKey(source.folderId))) return null;
      records.set(memberKey(newItemKey), {
        kind: "member",
        itemKey: newItemKey,
        folderId: source.folderId,
      });
      return source.folderId;
    });
  }

  /** One queued, atomic write for the whole change, then one broadcast of the new state. */
  private async mutate<T>(apply: (records: RecordMap) => T): Promise<T> {
    let changed = false;
    const result = await this.mutateCache((records) => apply(records), {
      afterCommit: () => {
        changed = true;
      },
    });
    if (changed) await this.notify();
    return result;
  }

  private async notify(): Promise<void> {
    const snapshot = await this.getSnapshot();
    await Promise.all(
      [...this.listeners].map(async (listener) => {
        try {
          await listener(snapshot);
        } catch (error) {
          this.changeLogger.warn({ err: error }, "Folder change listener failed");
        }
      }),
    );
  }
}

/** The registry at its one place on disk, beside workspaces.json. */
export function createFolderRegistry(paseoHome: string, logger: Logger): FileBackedFolderRegistry {
  return new FileBackedFolderRegistry(join(paseoHome, "projects", "folders.json"), logger);
}

/** Tests and older constructors pass nothing; sessions of one server must still share one. */
export function resolveFolderRegistry(
  registry: FileBackedFolderRegistry | undefined,
  paseoHome: string,
  logger: Logger,
): FileBackedFolderRegistry {
  return registry ?? createFolderRegistry(paseoHome, logger);
}

function newFolderId(): string {
  return `fld_${randomBytes(8).toString("hex")}`;
}

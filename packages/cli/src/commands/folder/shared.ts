import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { findFolderByRef, type Folder } from "@getpaseo/protocol/folders";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, OutputSchema } from "../../output/index.js";

export interface FolderCommandOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
}

export interface FolderRow {
  id: string;
  emoji: string;
  name: string;
  items: number;
}

export const folderSchema: OutputSchema<FolderRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 20 },
    { header: "EMOJI", field: "emoji", width: 6 },
    { header: "NAME", field: "name", width: 28 },
    { header: "ITEMS", field: "items", width: 6 },
  ],
};

export function toFolderRow(folder: Folder, items: number): FolderRow {
  return { id: folder.id, emoji: folder.emoji ?? "", name: folder.name, items };
}

/** Connects, runs, closes. Any failure that is not already a CommandError gets `failureCode`. */
export async function withFolderClient<T>(
  options: FolderCommandOptions,
  failureCode: string,
  run: (client: DaemonClient) => Promise<T>,
): Promise<T> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });
  try {
    return await run(client);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: failureCode, message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** A folder by id or name (any case). */
export function requireFolder(folders: readonly Folder[], ref: string): Folder {
  const folder = findFolderByRef(folders, ref);
  if (!folder) {
    throw {
      code: "FOLDER_NOT_FOUND",
      message: `Folder not found: ${ref}`,
      details: "List folders with: paseo folder ls",
    } satisfies CommandError;
  }
  return folder;
}

export function countItems(membership: Record<string, string>, folderId: string): number {
  return Object.values(membership).filter((id) => id === folderId).length;
}

import type { Command } from "commander";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";
import { findFolderByRef } from "@getpaseo/protocol/folders";
import { withFolderClient, type FolderCommandOptions } from "./shared.js";

export interface FolderSetOptions extends FolderCommandOptions {
  /** --unfiled: take the workspaces out of their folders; every argument is a workspace id. */
  unfiled?: boolean;
  /** --create: make the folder (named by the first argument) when none matches. */
  create?: boolean;
}

interface FolderSetResult {
  folder: string;
  status: "filed" | "unfiled";
  workspaces: number;
}

const folderSetSchema: OutputSchema<FolderSetResult> = {
  idField: "folder",
  columns: [
    { header: "FOLDER", field: "folder", width: 28 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "WORKSPACES", field: "workspaces", width: 12 },
  ],
};

/** `<folder> <workspaceId...>`, or `<workspaceId...>` with --unfiled. */
export function parseFolderSetArgs(
  args: readonly string[],
  unfiled: boolean,
): { folderRef: string | null; workspaceIds: string[] } {
  const folderRef = unfiled ? null : (args[0]?.trim() ?? "");
  const workspaceIds = (unfiled ? args : args.slice(1)).map((id) => id.trim()).filter(Boolean);
  if (folderRef === "" || workspaceIds.length === 0) {
    throw {
      code: "INVALID_ARGUMENTS",
      message: unfiled
        ? "Pass at least one workspace id"
        : "Pass a folder and at least one workspace id",
      details:
        "Usage: paseo folder set <folder> <workspace-id...> | paseo folder set --unfiled <workspace-id...>",
    } satisfies CommandError;
  }
  return { folderRef, workspaceIds: [...new Set(workspaceIds)] };
}

export async function runSetCommand(
  args: string[],
  options: FolderSetOptions,
  _command: Command,
): Promise<SingleResult<FolderSetResult>> {
  const { folderRef, workspaceIds } = parseFolderSetArgs(args, options.unfiled === true);
  return withFolderClient(options, "FOLDER_SET_FAILED", async (client) => {
    let folder = null;
    if (folderRef !== null) {
      const { folders } = await client.listFolders();
      folder = findFolderByRef(folders, folderRef);
      if (!folder) {
        if (!options.create) {
          throw {
            code: "FOLDER_NOT_FOUND",
            message: `Folder not found: ${folderRef}`,
            details: "List folders with: paseo folder ls, or pass --create to make it",
          } satisfies CommandError;
        }
        folder = await client.createFolder({ name: folderRef });
      }
    }
    await client.assignToFolder(workspaceIds, folder?.id ?? null);
    return {
      type: "single",
      data: {
        folder: folder?.name ?? "Unfiled",
        status: folder ? "filed" : "unfiled",
        workspaces: workspaceIds.length,
      },
      schema: folderSetSchema,
    };
  });
}

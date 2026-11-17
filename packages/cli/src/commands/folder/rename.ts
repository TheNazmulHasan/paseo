import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import {
  countItems,
  folderSchema,
  requireFolder,
  toFolderRow,
  withFolderClient,
  type FolderCommandOptions,
  type FolderRow,
} from "./shared.js";

export async function runRenameCommand(
  folderRef: string,
  newName: string,
  options: FolderCommandOptions,
  _command: Command,
): Promise<SingleResult<FolderRow>> {
  return withFolderClient(options, "FOLDER_RENAME_FAILED", async (client) => {
    const { folders, membership } = await client.listFolders();
    const folder = requireFolder(folders, folderRef);
    const updated = await client.updateFolder({ folderId: folder.id, name: newName });
    return {
      type: "single",
      data: toFolderRow(updated, countItems(membership, updated.id)),
      schema: folderSchema,
    };
  });
}

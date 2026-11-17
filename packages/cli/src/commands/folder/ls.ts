import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import {
  countItems,
  folderSchema,
  toFolderRow,
  withFolderClient,
  type FolderCommandOptions,
  type FolderRow,
} from "./shared.js";

export async function runLsCommand(
  options: FolderCommandOptions,
  _command: Command,
): Promise<ListResult<FolderRow>> {
  return withFolderClient(options, "FOLDER_LS_FAILED", async (client) => {
    const { folders, membership } = await client.listFolders();
    return {
      type: "list",
      data: folders.map((folder) => toFolderRow(folder, countItems(membership, folder.id))),
      schema: folderSchema,
    };
  });
}

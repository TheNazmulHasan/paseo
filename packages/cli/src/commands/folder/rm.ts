import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import { requireFolder, withFolderClient, type FolderCommandOptions } from "./shared.js";

interface FolderRemoveResult {
  id: string;
  name: string;
  status: "removed";
  unfiled: number;
}

const folderRemoveSchema: OutputSchema<FolderRemoveResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 20 },
    { header: "NAME", field: "name", width: 28 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "UNFILED", field: "unfiled", width: 8 },
  ],
};

export async function runRmCommand(
  folderRef: string,
  options: FolderCommandOptions,
  _command: Command,
): Promise<SingleResult<FolderRemoveResult>> {
  return withFolderClient(options, "FOLDER_RM_FAILED", async (client) => {
    const { folders } = await client.listFolders();
    const folder = requireFolder(folders, folderRef);
    const removed = await client.deleteFolder(folder.id);
    return {
      type: "single",
      data: {
        id: removed.folder.id,
        name: removed.folder.name,
        status: "removed",
        unfiled: removed.releasedItemKeys.length,
      },
      schema: folderRemoveSchema,
    };
  });
}

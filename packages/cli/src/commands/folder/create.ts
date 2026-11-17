import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import {
  folderSchema,
  toFolderRow,
  withFolderClient,
  type FolderCommandOptions,
  type FolderRow,
} from "./shared.js";

export interface FolderCreateOptions extends FolderCommandOptions {
  emoji?: string;
}

export async function runCreateCommand(
  name: string,
  options: FolderCreateOptions,
  _command: Command,
): Promise<SingleResult<FolderRow>> {
  return withFolderClient(options, "FOLDER_CREATE_FAILED", async (client) => {
    const folder = await client.createFolder({
      name,
      ...(options.emoji ? { emoji: options.emoji } : {}),
    });
    return { type: "single", data: toFolderRow(folder, 0), schema: folderSchema };
  });
}

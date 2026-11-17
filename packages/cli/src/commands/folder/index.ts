import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runRenameCommand } from "./rename.js";
import { runRmCommand } from "./rm.js";
import { runSetCommand } from "./set.js";

export function createFolderCommand(): Command {
  const folder = new Command("folder").description("Manage sidebar folders for workspaces");

  addJsonAndDaemonHostOptions(
    folder.command("ls").description("List folders and how many items each holds"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    folder
      .command("create")
      .description("Create a folder")
      .argument("<name>", "Folder name (unique, any case)")
      .option("--emoji <emoji>", "Emoji shown before the name")
      .allowExcessArguments(false),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    folder
      .command("set")
      .description("Put workspaces in a folder, or take them out of folders with --unfiled")
      .argument("<args...>", "<folder> <workspace-id...>, or <workspace-id...> with --unfiled")
      .option("--unfiled", "Move the workspaces to Unfiled (no folder)")
      .option("--create", "Create the folder when no folder matches the name"),
  ).action(withOutput(runSetCommand));

  addJsonAndDaemonHostOptions(
    folder
      .command("rm")
      .description("Delete a folder; its items become Unfiled")
      .argument("<folder>", "Folder id or name")
      .allowExcessArguments(false),
  ).action(withOutput(runRmCommand));

  addJsonAndDaemonHostOptions(
    folder
      .command("rename")
      .description("Rename a folder")
      .argument("<folder>", "Folder id or name")
      .argument("<new-name>", "New folder name")
      .allowExcessArguments(false),
  ).action(withOutput(runRenameCommand));

  return folder;
}

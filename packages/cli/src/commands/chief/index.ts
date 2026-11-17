import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runSearchCommand } from "./search.js";
import { runStatesCommand } from "./states.js";

export function createChiefCommand(): Command {
  const chief = new Command("chief").description(
    "What Chief sees: every open session and its state, and a text search over all sessions",
  );

  addJsonAndDaemonHostOptions(
    chief
      .command("states")
      .description("List open sessions: needs_you, working, your_move, parked")
      .option("--state <states>", "Only these states, comma separated (e.g. your_move,needs_you)")
      .option("--workspace <id>", "Only this workspace id")
      .option("--folder <folder>", "Only this folder (id or name; 'unfiled' for none)")
      .option("--stale-days <days>", "Only sessions idle for at least this many days")
      .option("--limit <n>", "Maximum rows (default 100)")
      .allowExcessArguments(false),
  ).action(withOutput(runStatesCommand));

  addJsonAndDaemonHostOptions(
    chief
      .command("search")
      .description("Search what was said in every session, archived ones included")
      .argument("<query>", 'Words (AND-ed) and "quoted phrases"; quote the whole query')
      .option("--exclude-archived", "Skip archived sessions")
      .option("--since <date>", "Ignore messages before this ISO date")
      .option("--until <date>", "Ignore messages after this ISO date (a bare date includes that day)")
      .option("--workspace <id>", "Only this workspace id")
      .option("--limit <n>", "Maximum hits (default 20)")
      .allowExcessArguments(false),
  ).action(withOutput(runSearchCommand));

  return chief;
}

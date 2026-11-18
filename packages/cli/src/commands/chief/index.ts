import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runHomeGet, runHomeLayout, runHomeRefresh, runHomeSnooze } from "./home.js"; // Nazmul mod (home-map)
import { runSearchCommand } from "./search.js";
import { runStatesCommand } from "./states.js";

export function createChiefCommand(): Command {
  const chief = new Command("chief").description(
    "What Chief sees: every open session and its state, and a text search over all sessions",
  );

  addJsonAndDaemonHostOptions(
    chief
      .command("states")
      .description("List open sessions: needs_you, working, your_move, stopped, parked")
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

  // Nazmul mod (home-map): Home's brief, Later and Chief layout from a shell.
  const home = new Command("home").description(
    "Home's daemon side: the brief, what is put off with Later, and Chief's layout",
  );
  addJsonAndDaemonHostOptions(home.allowExcessArguments(false)).action(withOutput(runHomeGet));
  addJsonAndDaemonHostOptions(
    home
      .command("refresh")
      .description("Write a new brief now (returns at once; the screen updates itself)")
      .allowExcessArguments(false),
  ).action(withOutput(runHomeRefresh));
  addJsonAndDaemonHostOptions(
    home
      .command("snooze")
      .description("Put a session off with Later")
      .argument("<agentId>", "The agent id")
      .argument("<until>", "ISO time, 3h, tomorrow, nextweek, or now (bring it back)")
      .allowExcessArguments(false),
  ).action(withOutput(runHomeSnooze));
  addJsonAndDaemonHostOptions(
    home
      .command("layout")
      .description("Set Chief's layout from a JSON file, or put Home back to normal")
      .option("--file <path>", "A layout JSON file (title, reason, createdAt, groups)")
      .option("--clear", "Back to normal")
      .allowExcessArguments(false),
  ).action(withOutput(runHomeLayout));
  chief.addCommand(home);

  return chief;
}

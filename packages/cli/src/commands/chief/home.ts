import { readFileSync } from "node:fs";
import type { Command } from "commander";
import type { HomeSnapshot } from "@getpaseo/protocol/home";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import { invalidArguments, withChiefClient, type ChiefCommandOptions } from "./shared.js";

/** Nazmul mod (home-map): `paseo chief home ...`, Home's daemon side from a shell. */

export interface HomeRow {
  headline: string;
  since: string;
  briefAt: string;
  briefRunning: boolean;
  closedToday: number;
  snoozed: number;
  kept: number;
  layout: string;
}

export const homeSchema: OutputSchema<HomeRow> = {
  idField: "briefAt",
  columns: [
    { header: "HEADLINE", field: "headline", width: 60 },
    { header: "BRIEF AT", field: (row) => row.briefAt.slice(0, 16).replace("T", " "), width: 16 },
    { header: "RUNNING", field: (row) => (row.briefRunning ? "yes" : "no"), width: 7 },
    { header: "CLOSED TODAY", field: "closedToday", width: 12 },
    { header: "LATER", field: "snoozed", width: 5 },
    { header: "KEPT", field: "kept", width: 5 },
    { header: "LAYOUT", field: "layout", width: 20 },
  ],
};

export function toHomeRow(snapshot: HomeSnapshot): HomeRow {
  return {
    headline: snapshot.brief?.headline ?? "(no brief yet)",
    since: snapshot.brief?.since ?? "",
    briefAt: snapshot.brief?.generatedAt ?? "",
    briefRunning: snapshot.briefRunning,
    closedToday: snapshot.closedToday,
    snoozed: Object.keys(snapshot.state.snoozed).length,
    kept: Object.keys(snapshot.state.kept).length,
    layout: snapshot.state.chiefLayout?.title ?? "(normal)",
  };
}

async function run(
  options: ChiefCommandOptions,
  action: "get" | "refresh" | "snooze" | "keep" | "set_layout",
  input: Record<string, unknown> = {},
): Promise<SingleResult<HomeRow>> {
  return withChiefClient(options, "CHIEF_HOME_FAILED", async (client) => ({
    type: "single",
    data: toHomeRow(await client.homeRequest(action, input)),
    schema: homeSchema,
  }));
}

export function runHomeGet(options: ChiefCommandOptions, _command: Command) {
  return run(options, "get");
}

export function runHomeRefresh(options: ChiefCommandOptions, _command: Command) {
  return run(options, "refresh");
}

export function runHomeSnooze(
  agentId: string,
  until: string,
  options: ChiefCommandOptions,
  _command: Command,
) {
  const value = until === "now" ? null : until;
  return run(options, "snooze", { agentId, until: value });
}

export interface HomeLayoutOptions extends ChiefCommandOptions {
  file?: string;
  clear?: boolean;
}

/** `--clear` puts Home back to normal; `--file layout.json` sets Chief's layout (see HomeLayoutSchema). */
export function runHomeLayout(options: HomeLayoutOptions, _command: Command) {
  if (options.clear && options.file) {
    throw invalidArguments("Use either --clear or --file, not both.");
  }
  if (!options.clear && !options.file) {
    throw invalidArguments("Give --file <layout.json> or --clear.");
  }
  let layout: unknown = null;
  if (!options.clear && options.file) {
    try {
      layout = JSON.parse(readFileSync(options.file, "utf8")) as unknown;
    } catch (error) {
      throw invalidArguments(
        `Cannot read ${options.file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return run(options, "set_layout", { layout });
}

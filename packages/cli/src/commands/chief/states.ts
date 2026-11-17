import type { Command } from "commander";
import type { ListResult, OutputSchema } from "../../output/index.js";
import {
  SESSION_STATE_NAMES,
  invalidArguments,
  oneLine,
  parseLimit,
  withChiefClient,
  type ChiefCommandOptions,
} from "./shared.js";

export interface ChiefStatesOptions extends ChiefCommandOptions {
  state?: string;
  workspace?: string;
  folder?: string;
  staleDays?: string;
  limit?: string;
}

/** The fields `session_states` returns; the table shows a few, --json shows all. */
export interface SessionStateRow {
  agentId: string;
  title: string | null;
  state: string;
  workspaceTitle: string | null;
  folder: string | null;
  lastActivityAt: string | null;
  yourMoveText: string | null;
}

const STATE_COLORS: Record<string, string> = {
  needs_you: "red",
  working: "green",
  your_move: "yellow",
  parked: "gray",
};

export const statesSchema: OutputSchema<SessionStateRow> = {
  idField: "agentId",
  columns: [
    { header: "STATE", field: "state", width: 10, color: (value) => STATE_COLORS[String(value)] },
    { header: "TITLE", field: (row) => oneLine(row.title ?? row.agentId.slice(0, 8), 36), width: 36 },
    { header: "WORKSPACE", field: (row) => oneLine(row.workspaceTitle, 24), width: 24 },
    { header: "FOLDER", field: (row) => row.folder ?? "Unfiled", width: 14 },
    { header: "LAST ACTIVITY", field: (row) => (row.lastActivityAt ?? "").slice(0, 16).replace("T", " "), width: 16 },
    { header: "YOUR MOVE", field: (row) => oneLine(row.yourMoveText, 40), width: 40 },
    { header: "ID", field: (row) => row.agentId.slice(0, 8), width: 8 },
  ],
};

/** `--state your_move,needs_you` as a list of known states. */
export function parseStates(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const states = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = states.filter((state) => !(SESSION_STATE_NAMES as readonly string[]).includes(state));
  if (unknown.length > 0) {
    throw invalidArguments(
      `Unknown state: ${unknown.join(", ")}. Use: ${SESSION_STATE_NAMES.join(", ")}`,
    );
  }
  return states;
}

export async function runStatesCommand(
  options: ChiefStatesOptions,
  _command: Command,
): Promise<ListResult<SessionStateRow>> {
  const staleDays = options.staleDays === undefined ? undefined : Number(options.staleDays);
  if (staleDays !== undefined && !(staleDays > 0)) {
    throw invalidArguments(`--stale-days must be a positive number, got: ${options.staleDays}`);
  }
  const input = {
    ...(parseStates(options.state) ? { state: parseStates(options.state) } : {}),
    ...(options.workspace ? { workspaceId: options.workspace } : {}),
    ...(options.folder ? { folder: options.folder } : {}),
    ...(staleDays !== undefined ? { staleDays } : {}),
    ...(parseLimit(options.limit) ? { limit: parseLimit(options.limit) } : {}),
  };
  return withChiefClient(options, "CHIEF_STATES_FAILED", async (client) => {
    const result = (await client.chiefQuery("states", input)) as { sessions: SessionStateRow[] };
    return { type: "list", data: result.sessions, schema: statesSchema };
  });
}

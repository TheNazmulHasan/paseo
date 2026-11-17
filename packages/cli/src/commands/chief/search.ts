import type { Command } from "commander";
import type { ListResult, OutputSchema } from "../../output/index.js";
import { oneLine, parseLimit, withChiefClient, type ChiefCommandOptions } from "./shared.js";

export interface ChiefSearchOptions extends ChiefCommandOptions {
  /** Commander turns `--exclude-archived` into `excludeArchived: true`. */
  excludeArchived?: boolean;
  since?: string;
  until?: string;
  workspace?: string;
  limit?: string;
}

/** The fields `search_sessions` returns per hit; the table shows a few, --json shows all. */
export interface SearchHitRow {
  agentId: string;
  title: string | null;
  workspaceTitle: string | null;
  folder: string | null;
  archived: boolean;
  date: string | null;
  who: string;
  snippet: string;
  source: string;
  private: boolean;
  url: string | null;
}

export const searchSchema: OutputSchema<SearchHitRow> = {
  idField: "agentId",
  columns: [
    { header: "DATE", field: (row) => (row.date ?? "").slice(0, 10), width: 10 },
    { header: "WHO", field: "who", width: 6 },
    { header: "TITLE", field: (row) => oneLine(row.title ?? row.agentId.slice(0, 8), 28), width: 28 },
    { header: "WORKSPACE", field: (row) => oneLine(row.workspaceTitle, 20), width: 20 },
    { header: "SNIPPET", field: (row) => oneLine(row.snippet, 70), width: 70 },
    { header: "ID", field: (row) => row.agentId.slice(0, 8), width: 8 },
  ],
};

export async function runSearchCommand(
  query: string,
  options: ChiefSearchOptions,
  _command: Command,
): Promise<ListResult<SearchHitRow>> {
  const input = {
    query,
    ...(options.excludeArchived ? { includeArchived: false } : {}),
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    ...(options.workspace ? { workspaceId: options.workspace } : {}),
    ...(parseLimit(options.limit) ? { limit: parseLimit(options.limit) } : {}),
  };
  return withChiefClient(options, "CHIEF_SEARCH_FAILED", async (client) => {
    const result = (await client.chiefQuery("search", input)) as { hits: SearchHitRow[] };
    return { type: "list", data: result.hits, schema: searchSchema };
  });
}

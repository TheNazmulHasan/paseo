import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppActionInfoSchema } from "@getpaseo/protocol/chief";
import type { FoldersSnapshot } from "@getpaseo/protocol/folders";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { buildWorkspaceMarkdownLink } from "@getpaseo/protocol/workspace-link";

import { ensureValidJson } from "../json-utils.js";
import {
  type PaseoToolConfig,
  type PaseoToolExecutionContext,
  type PaseoToolResult,
} from "../agent/tools/types.js";
import {
  appCommandBus as defaultBus,
  type AppCommandBus,
  type AppCommandOutcome,
} from "./app-command-bus.js";
import { createPrivacyGuard, readChiefConfig, type ChiefConfig } from "./privacy.js";
import {
  DEFAULT_SEARCH_LIMIT,
  searchSessions,
  type SearchableSession,
} from "./search.js";
import {
  SESSION_STATES,
  selectSessionStates,
  type SessionState,
} from "@getpaseo/protocol/session-state";
import {
  buildSessionStateRows,
  type AgentStateSource,
  type WorkspaceSource,
} from "./session-rows.js";
import { registerHomeTools } from "../home/home-tools.js"; // Nazmul mod (home-map)
import {
  createTranscriptLocator,
  defaultClaudeConfigDirs,
  defaultCodexHomes,
  type TranscriptLocator,
} from "./transcripts.js";

type RegisterTool = (
  name: string,
  config: PaseoToolConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
  handler: (input: any, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>,
) => void;

/** The slice of a stored agent record the tools read. */
export interface StoredSessionSource {
  id: string;
  title?: string | null;
  cwd: string;
  workspaceId?: string;
  updatedAt: string;
  lastActivityAt?: string;
  archivedAt?: string | null;
  internal?: boolean;
  persistence?: {
    sessionId?: string | null;
    nativeHandle?: string | null;
    metadata?: { threadId?: unknown } | null;
  } | null;
}

/** What the read side (`session_states`, `search_sessions`) needs; shared by the tools and the CLI RPC. */
export interface ChiefCoreOptions {
  serverId?: string;
  paseoHome?: string;
  /** Live and stored agents that are not archived (background workspaces included). */
  listAgents: () => Promise<readonly AgentStateSource[]>;
  /** Every stored agent record, archived included. */
  listStoredAgents: () => Promise<readonly StoredSessionSource[]>;
  workspaceRegistry: { list: () => Promise<readonly WorkspaceSource[]> };
  projectRegistry?: { list: () => Promise<readonly { projectId: string; displayName: string; customName?: string | null }[]> };
  folderRegistry?: { getSnapshot: () => Promise<FoldersSnapshot> };
  /** Test seams. */
  locator?: TranscriptLocator;
  readConfig?: () => ChiefConfig;
}

export interface ChiefToolsOptions extends ChiefCoreOptions {
  registerTool: RegisterTool;
  bus?: AppCommandBus;
}

export interface SessionStatesInput {
  state?: SessionState[];
  workspaceId?: string;
  folder?: string;
  staleDays?: number;
  limit?: number;
}

export interface SearchSessionsInput {
  query: string;
  includeArchived?: boolean;
  since?: string;
  until?: string;
  workspaceId?: string;
  limit?: number;
}

const SessionStateEnum = z.enum(SESSION_STATES);

const SessionStateRowSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspaceTitle: z.string().nullable(),
  projectName: z.string().nullable(),
  folder: z.string().nullable(),
  folderId: z.string().nullable(),
  pinned: z.boolean(),
  background: z.boolean(),
  state: SessionStateEnum,
  yourMoveText: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  link: z.string().nullable(),
  url: z.string().nullable(),
  workspaceLink: z.string().nullable(),
});

const SearchHitSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspaceTitle: z.string().nullable(),
  folder: z.string().nullable(),
  archived: z.boolean(),
  date: z.string().nullable(),
  who: z.enum(["you", "agent", "title"]),
  snippet: z.string(),
  source: z.enum(["claude", "codex", "specstory", "title"]),
  private: z.boolean(),
  link: z.string().nullable(),
  url: z.string().nullable(),
});

const APP_COMMAND_DESCRIPTION = [
  "Drive the desktop Paseo app the way the user's hands do. The app must be open.",
  "Actions and their args:",
  "- open_workspace {workspaceId, tabId?, agentId?, serverId?}: open a workspace like a sidebar click; with tabId or agentId, with that session focused.",
  "- open_view {viewId | name}: open a saved view.",
  "- run_action {actionId, args?}: run a keyboard action or a Command Center item. Ids come from list_app_actions; args carry what the action needs (e.g. {index: 3}).",
  "Returns whether an app client received it, and the app's answer (ok or an error) when it replies within a few seconds.",
].join("\n");

/** Claude config dirs named in the provider config (e.g. a second Claude login). */
function configuredClaudeDirs(paseoHome: string | undefined): string[] {
  if (!paseoHome) return [];
  try {
    const config = JSON.parse(readFileSync(join(paseoHome, "config.json"), "utf8")) as {
      agents?: { providers?: Record<string, { env?: Record<string, string> }> };
    };
    return Object.values(config.agents?.providers ?? {})
      .map((provider) => provider.env?.CLAUDE_CONFIG_DIR)
      .filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
  } catch {
    return [];
  }
}

function sessionIdsOf(record: StoredSessionSource): string[] {
  const ids = [
    record.persistence?.sessionId,
    record.persistence?.nativeHandle,
    typeof record.persistence?.metadata?.threadId === "string"
      ? record.persistence.metadata.threadId
      : null,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

function outcomeError(outcome: AppCommandOutcome): string | null {
  if (outcome.clients === 0) return "No Paseo app is connected, so nothing was done.";
  if (outcome.result && !outcome.result.ok) return outcome.result.error ?? "The app refused.";
  return null;
}

/**
 * Nazmul mod (chief): the read side as plain functions. The MCP tools wrap them for agents, and the
 * `chief.query` RPC wraps them for `paseo chief`, so both see exactly the same rows.
 */
export function createChiefCore(options: ChiefCoreOptions) {
  const { serverId } = options;

  async function lookups() {
    const [workspaces, projects, folders] = await Promise.all([
      options.workspaceRegistry.list(),
      options.projectRegistry?.list() ?? Promise.resolve([]),
      options.folderRegistry?.getSnapshot() ?? Promise.resolve(null),
    ]);
    return {
      workspaces: new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace])),
      projectNames: new Map(
        projects.map((project) => [project.projectId, project.customName ?? project.displayName]),
      ),
      folders,
    };
  }

  async function sessionRows({ state, workspaceId, folder, staleDays, limit = 100 }: SessionStatesInput) {
    const [agents, stored, context] = await Promise.all([
      options.listAgents(),
      options.listStoredAgents(),
      lookups(),
    ]);
    const lastActivityById = new Map(
      stored.flatMap((record) =>
        record.lastActivityAt ? [[record.id, record.lastActivityAt] as const] : [],
      ),
    );
    const rows = buildSessionStateRows({
      agents,
      lastActivityById,
      workspaces: context.workspaces,
      projectNames: context.projectNames,
      folders: context.folders,
      serverId,
    });
    const matched = selectSessionStates(rows, { state, workspaceId, folder, staleDays });
    const counts: Record<string, number> = {};
    for (const row of matched) counts[row.state] = (counts[row.state] ?? 0) + 1;
    return { sessions: matched.slice(0, limit), matched: matched.length, counts };
  }

  /**
   * The tool's and the CLI's view: without the Home-only fields (`card`, `lastUserMessageAt`, `chief`), so
   * Chief's context does not fill with card text; `home_get` is where Chief reads cards.
   */
  async function sessionStates(input: SessionStatesInput) {
    const result = await sessionRows(input);
    return {
      ...result,
      sessions: result.sessions.map(({ card: _card, lastUserMessageAt: _last, chief: _chief, ...row }) => row),
    };
  }

  async function search({
    query,
    includeArchived = true,
    since,
    until,
    workspaceId,
    limit = DEFAULT_SEARCH_LIMIT,
  }: SearchSessionsInput) {
    const [stored, context] = await Promise.all([options.listStoredAgents(), lookups()]);
    const sessions: SearchableSession[] = stored
      .filter((record) => !record.internal)
      .map((record) => {
        const workspace = record.workspaceId ? context.workspaces.get(record.workspaceId) : null;
        return {
          agentId: record.id,
          title: record.title ?? null,
          workspaceId: record.workspaceId ?? null,
          workspaceTitle: workspace ? (workspace.title ?? workspace.displayName) : null,
          cwds: [record.cwd, workspace?.cwd],
          sessionIds: sessionIdsOf(record),
          archived: Boolean(record.archivedAt),
          lastActivityAt: record.lastActivityAt ?? record.updatedAt ?? null,
        };
      })
      .sort((a, b) => Date.parse(b.lastActivityAt ?? "") - Date.parse(a.lastActivityAt ?? "") || 0);

    const config = options.readConfig?.() ?? readChiefConfig(options.paseoHome);
    const outcome = await searchSessions(
      {
        sessions,
        locator:
          options.locator ??
          createTranscriptLocator({
            claudeConfigDirs: defaultClaudeConfigDirs(configuredClaudeDirs(options.paseoHome)),
            codexHomes: defaultCodexHomes(),
          }),
        guard: createPrivacyGuard({ config }),
        config,
      },
      { query, includeArchived, since, until, workspaceId, limit },
    );

    const hits = outcome.hits.map((hit) => {
      const workspace = hit.session.workspaceId
        ? context.workspaces.get(hit.session.workspaceId)
        : null;
      const folderId = hit.session.workspaceId
        ? (context.folders?.membership[hit.session.workspaceId] ?? null)
        : null;
      const url = serverId ? buildAgentDeepLink({ serverId, agentId: hit.session.agentId }) : null;
      return {
        agentId: hit.session.agentId,
        title: hit.session.title,
        workspaceId: hit.session.workspaceId,
        workspaceTitle: workspace ? (workspace.title ?? workspace.displayName) : null,
        folder: context.folders?.folders.find((folder) => folder.id === folderId)?.name ?? null,
        archived: hit.session.archived,
        date: hit.at,
        who: hit.who,
        snippet: hit.snippet,
        source: hit.source,
        private: hit.private,
        link: url
          ? buildWorkspaceMarkdownLink(hit.session.title?.trim() || hit.session.agentId.slice(0, 8), url)
          : null,
        url,
      };
    });
    return {
      hits,
      sessionsScanned: outcome.sessionsScanned,
      sessionsWithoutTranscript: outcome.sessionsWithoutTranscript,
      partial: outcome.partial,
      elapsedMs: outcome.elapsedMs,
    };
  }

  return { sessionStates, sessionRows, searchSessions: search };
}

export type ChiefCore = ReturnType<typeof createChiefCore>;

/**
 * Nazmul mod (chief): the tool layer of the Chief personal-assistant agent. `session_states` and
 * `search_sessions` are the eyes (every open session and its state; text search over every session
 * ever, archived included). `app_command` and `list_app_actions` are the hands (drive the app).
 */
export function registerChiefTools(options: ChiefToolsOptions): void {
  const { registerTool } = options;
  const bus = options.bus ?? defaultBus;
  const core = createChiefCore(options);

  registerTool(
    "session_states",
    {
      title: "Session states",
      description:
        "Every open (non-archived) session with its state from the user's seat: needs_you (a permission is waiting), working (running), your_move (a finished turn the user has not looked at yet, or marked unread), stopped (ended in an error or was cut off: a crash, a rate limit), parked (idle and seen). Each row has workspace, project, folder (null = Unfiled), pinned/background flags, last activity, the 'your move' line when there is one, and a link. Sorted needs_you, working, your_move, stopped, parked; newest first inside each.",
      inputSchema: {
        state: z.array(SessionStateEnum).optional().describe("Only these states."),
        workspaceId: z.string().optional(),
        folder: z
          .string()
          .optional()
          .describe("Folder id or name (any case); 'unfiled' for workspaces in no folder."),
        staleDays: z
          .number()
          .positive()
          .optional()
          .describe("Only sessions idle for at least this many days."),
        limit: z.number().int().positive().max(1000).optional().default(100),
      },
      outputSchema: {
        sessions: z.array(SessionStateRowSchema),
        matched: z.number(),
        counts: z.record(z.string(), z.number()),
      },
    },
    async (input) => ({
      content: [],
      structuredContent: ensureValidJson(await core.sessionStates(input)),
    }),
  );

  registerTool(
    "search_sessions",
    {
      title: "Search sessions",
      description: [
        "Search the text of every session's messages (what the user and the agent said, not tool output), archived sessions included. Case-insensitive; words are AND-ed inside one message; \"quoted phrases\" must appear as written.",
        "Returns one hit per session: the first matching message, its date, who said it, a ~200 character snippet, and a link. Sessions are scanned newest first and the scan stops at limit.",
        "Sources: the provider's own transcript (Claude Code, Codex), falling back to the project's SpecStory export when the provider deleted it. Sessions with neither (Antigravity) match on their title only (who: title).",
        "Private workspaces return no text: the snippet reads '(private workspace — text withheld)'.",
      ].join(" "),
      inputSchema: {
        query: z.string().trim().min(1, "query is required"),
        includeArchived: z.boolean().optional().default(true),
        since: z.string().optional().describe("ISO date or time; ignore messages before it."),
        until: z.string().optional().describe("ISO date or time; a bare date includes that day."),
        workspaceId: z.string().optional(),
        limit: z.number().int().positive().max(200).optional().default(DEFAULT_SEARCH_LIMIT),
      },
      outputSchema: {
        hits: z.array(SearchHitSchema),
        sessionsScanned: z.number(),
        sessionsWithoutTranscript: z.number(),
        partial: z.boolean(),
        elapsedMs: z.number(),
      },
    },
    async (input) => ({
      content: [],
      structuredContent: ensureValidJson(await core.searchSessions(input)),
    }),
  );

  registerTool(
    "app_command",
    {
      title: "App command",
      description: APP_COMMAND_DESCRIPTION,
      inputSchema: {
        action: z.enum(["open_workspace", "open_view", "run_action"]),
        args: z.record(z.string(), z.unknown()).optional().default({}),
      },
      outputSchema: {
        delivered: z.boolean(),
        clients: z.number(),
        ok: z.boolean().nullable(),
        error: z.string().nullable(),
      },
    },
    async ({ action, args = {} }) => {
      const outcome = await bus.send(action, args);
      return {
        content: [],
        structuredContent: ensureValidJson({
          delivered: outcome.clients > 0,
          clients: outcome.clients,
          ok: outcome.result ? outcome.result.ok : null,
          error: outcomeError(outcome),
        }),
      };
    },
  );

  registerTool(
    "list_app_actions",
    {
      title: "List app actions",
      description:
        "List every action app_command can run with run_action: the app's keyboard actions and its Command Center items, each with an id and a help label. Asked of the live app, so it reflects the screen the user is on and any plugin items.",
      inputSchema: {},
      outputSchema: { actions: z.array(AppActionInfoSchema) },
    },
    async () => {
      const outcome = await bus.send("list_actions", {});
      const error = outcomeError(outcome);
      if (error) throw new Error(error);
      if (!outcome.result) {
        throw new Error("The app did not answer in time. Is it open and up to date?");
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ actions: outcome.result.actions ?? [] }),
      };
    },
  );

  // Nazmul mod (home-map): home_get, home_refresh, home_snooze, home_set_layout.
  registerHomeTools({ registerTool, core, serverId: options.serverId });
}

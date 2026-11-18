import { z } from "zod";

import { HomeLayoutSchema, normalizeHomeLayout } from "@getpaseo/protocol/home";

import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import type { ChiefCore } from "../chief/chief-tools.js";
import { ensureValidJson } from "../json-utils.js";
import { buildHomeGet } from "./home-core.js";
import { homeHub, type HomeHub } from "./home-hub.js";
import { parseSnoozeUntil } from "./home-session.js";

type RegisterTool = (
  name: string,
  config: PaseoToolConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
  handler: (input: any, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>,
) => void;

const LAYOUT_INPUT = z.object({
  title: z.string().trim().min(1).describe('The section title, e.g. "Your 10 for today".'),
  reason: z
    .string()
    .trim()
    .default("because you asked")
    .describe('Why you made it, shown after "made by Chief at HH:MM", e.g. "because you asked".'),
  groups: z
    .array(
      z.object({
        label: z.string().trim().min(1).describe('Group heading, e.g. "Most urgent, do these first".'),
        items: z.array(
          z.object({
            agentId: z.string().min(1).describe("An agent id from home_get."),
            line: z.string().optional().describe("One short line for this item; the card's own text is used when absent."),
          }),
        ),
      }),
    )
    .min(1),
});

/**
 * Nazmul mod (home-map): Chief's levers on Home. `home_get` is exactly what the Home screen shows,
 * `home_refresh` rewrites the brief, `home_snooze` puts a session off with Later, `home_set_layout`
 * replaces the queue with a section Chief wrote (data only: ids, groups, one line each; the screen
 * is never drawn by Chief). Closing a session is the existing archive tool, not a Home tool.
 */
export function registerHomeTools(options: {
  registerTool: RegisterTool;
  core: Pick<ChiefCore, "sessionRows">;
  serverId?: string;
  hub?: HomeHub;
}): void {
  const { registerTool, core } = options;
  const hub = options.hub ?? homeHub;

  async function homeGet() {
    const service = hub.service();
    const [snapshot, rows] = await Promise.all([service.getSnapshot(), core.sessionRows({ limit: 1000 })]);
    return buildHomeGet({ rows: rows.sessions, snapshot });
  }

  registerTool(
    "home_get",
    {
      title: "Home",
      description:
        "Exactly what the user's Home screen shows right now: the headline and since line, the tally, his queue (now / today / later), what he put off with Later, recently worked on, running, check on these (finished or quiet, to look at or close), kept, tidy (stopped and repeated sessions), and a layout you wrote, if one is active. Every open session is in exactly one of queue, snoozed, running, checkOn, kept or tidy. Each item has agentId, title, nextStep, status, why, folder, workspace and a link. Use it to answer \"why is #2 urgent?\" or before reshaping Home.",
      inputSchema: {},
      outputSchema: {
        headline: z.string().nullable(),
        since: z.string().nullable(),
        briefGeneratedAt: z.string().nullable(),
        briefRunning: z.boolean(),
        closedToday: z.number(),
        tally: z.record(z.string(), z.number()),
        queue: z.record(z.string(), z.array(z.unknown())),
        snoozed: z.array(z.unknown()),
        recentlyWorkedOn: z.array(z.unknown()),
        running: z.array(z.unknown()),
        checkOn: z.array(z.unknown()),
        kept: z.array(z.unknown()),
        tidy: z.record(z.string(), z.array(z.unknown())),
        chiefLayout: z.unknown().nullable(),
      },
    },
    async () => ({ content: [], structuredContent: ensureValidJson(await homeGet()) }),
  );

  registerTool(
    "home_refresh",
    {
      title: "Refresh Home",
      description:
        "Rewrite Home's headline and ranking now (one small model call over all open session cards). Waits until it is done by default, then returns the new headline. Home also refreshes itself when sessions finish.",
      inputSchema: {
        wait: z.boolean().optional().default(true).describe("Wait for the new brief (default true)."),
      },
      outputSchema: {
        headline: z.string().nullable(),
        briefGeneratedAt: z.string().nullable(),
        briefRunning: z.boolean(),
      },
    },
    async ({ wait = true }) => {
      const snapshot = await hub.service().refresh({ wait });
      return {
        content: [],
        structuredContent: ensureValidJson({
          headline: snapshot.brief?.headline ?? null,
          briefGeneratedAt: snapshot.brief?.generatedAt ?? null,
          briefRunning: snapshot.briefRunning,
        }),
      };
    },
  );

  registerTool(
    "home_snooze",
    {
      title: "Snooze on Home",
      description:
        "Put one session off with Later: it leaves his queue and comes back by itself at `until`. `until` is an ISO time, or 3h, tomorrow (09:00 local), nextweek (Monday 09:00 local), or null to bring it back now.",
      inputSchema: {
        agentId: z.string().min(1),
        until: z.string().nullable().describe("ISO time, 3h, tomorrow, nextweek, or null."),
      },
      outputSchema: { agentId: z.string(), snoozedUntil: z.string().nullable() },
    },
    async ({ agentId, until }) => {
      const resolved = parseSnoozeUntil(until);
      const snapshot = await hub.service().snooze(agentId, resolved);
      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          snoozedUntil: snapshot.state.snoozed[agentId] ?? null,
        }),
      };
    },
  );

  registerTool(
    "home_set_layout",
    {
      title: "Set Home layout",
      description: [
        "Replace the queue on Home with a section YOU lay out, or put it back to normal. Pass a layout (title, reason, groups of agentIds with an optional one-line each, at most 12 items in total) or null for \"back to normal\".",
        "Write data only: ids from home_get, a label per group, one short line each. You never draw the screen. The layout stays until the user says back to normal or you replace it. Queue sessions you leave out stay reachable under it.",
        "First group is drawn strongest, the second fainter. Example: \"give me my 10, 3 urgent, 3 next, 4 last\" is three groups of 3, 3 and 4.",
      ].join(" "),
      inputSchema: { layout: LAYOUT_INPUT.nullable() },
      outputSchema: {
        active: z.boolean(),
        items: z.number(),
        unknownIds: z.array(z.string()),
      },
    },
    async ({ layout }) => {
      const service = hub.service();
      if (layout === null) {
        await service.setLayout(null);
        return { content: [], structuredContent: ensureValidJson({ active: false, items: 0, unknownIds: [] }) };
      }
      const parsed = HomeLayoutSchema.parse({ ...layout, createdAt: new Date().toISOString() });
      const open = new Set(
        (await core.sessionRows({ limit: 1000 })).sessions.filter((row) => !row.chief).map((row) => row.agentId),
      );
      const normalized = normalizeHomeLayout(parsed);
      const unknownIds = normalized.groups.flatMap((group) =>
        group.items.filter((entry) => !open.has(entry.agentId)).map((entry) => entry.agentId),
      );
      if (normalized.groups.every((group) => group.items.every((entry) => !open.has(entry.agentId)))) {
        throw new Error("None of those ids is an open session. Call home_get for the ids.");
      }
      const snapshot = await service.setLayout(normalized);
      return {
        content: [],
        structuredContent: ensureValidJson({
          active: snapshot.state.chiefLayout !== null,
          items: normalized.groups.reduce((total, group) => total + group.items.length, 0),
          unknownIds,
        }),
      };
    },
  );
}

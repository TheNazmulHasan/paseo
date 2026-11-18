import { z } from "zod";

import type { SessionState } from "./session-state.js";
import { HOME_CARD_IMPORTANCES, HOME_CARD_URGENCIES, type HomeCard } from "./topic-trail.js";

/**
 * Nazmul mod (home-map): Home v2, a briefing instead of an inventory. This file is the contract
 * both sides share, so the screen and Chief's `home_get` can never disagree about what Home shows:
 *
 * - the wire shapes (brief, state, layout, snapshot, the `home.request` RPC and the `home_update`
 *   push), and
 * - `buildHomeView`, the ONE pure function that puts every open session into exactly one group.
 *   The server (`home_get`) and the app screen both call it with the same inputs.
 *
 * Coverage guarantee (code, not model): every session handed in lands in exactly one group, and
 * `tally.gap` says out loud if the groups ever sum to less than the open count. A session with no
 * card yet is listed under Check on these as "reading", never hidden.
 */

export const HOME_QUEUE_GROUPS = ["now", "today", "later"] as const;
export type HomeQueueGroup = (typeof HOME_QUEUE_GROUPS)[number];

/** Sweep "Keep" hides a session from Check on these for this many days. */
export const HOME_KEEP_DAYS = 7;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** A Chief layout holds at most this many items in total. */
export const HOME_LAYOUT_MAX_ITEMS = 12;
export const HOME_LAYOUT_MAX_GROUPS = 6;
/** "Recently worked on" shows this many sessions first, then this many more per "Show more". */
export const HOME_RECENT_LIMIT = 10;
export const HOME_RECENT_PAGE = 10;

// ---------------------------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------------------------

/** Haiku's ranking over all open cards. Ids are agent ids. */
export const HomeBriefSchema = z.object({
  headline: z.string(),
  /** "Since last night: ..." or null. */
  since: z.string().nullable(),
  /** The order of the queue and the group each waiting session belongs to. */
  queue: z.array(z.object({ id: z.string(), group: z.enum(HOME_QUEUE_GROUPS) })),
  /** Check on these, most important first. */
  checkOn: z.array(z.string()),
  /** Repeats / answered elsewhere in the same workspace: shown under Tidy as finished. */
  superseded: z.array(z.string()),
  generatedAt: z.string(),
  /** Fingerprint of what the brief was made from (server-side skip-unchanged). */
  inputKey: z.string().optional(),
});
export type HomeBrief = z.infer<typeof HomeBriefSchema>;

export const HomeLayoutItemSchema = z.object({
  agentId: z.string(),
  /** One line Chief wrote for this item; the card's own text is used when absent. */
  line: z.string().optional(),
});
export const HomeLayoutSchema = z.object({
  title: z.string(),
  /** Why Chief made it ("because you asked"). */
  reason: z.string(),
  createdAt: z.string(),
  groups: z.array(z.object({ label: z.string(), items: z.array(HomeLayoutItemSchema) })),
});
export type HomeLayout = z.infer<typeof HomeLayoutSchema>;

export const HomeStateSchema = z.object({
  /** agentId -> ISO time the session comes back to the queue. */
  snoozed: z.record(z.string(), z.string()),
  /** agentId -> ISO time Sweep's "Keep" ends (HOME_KEEP_DAYS after it was pressed). */
  kept: z.record(z.string(), z.string()),
  chiefLayout: HomeLayoutSchema.nullable(),
});
export type HomeState = z.infer<typeof HomeStateSchema>;

export const EMPTY_HOME_STATE: HomeState = { snoozed: {}, kept: {}, chiefLayout: null };

/** What the daemon holds for Home, besides the cards (those ride on the agents). */
export const HomeSnapshotSchema = z.object({
  brief: HomeBriefSchema.nullable(),
  state: HomeStateSchema,
  /** Sessions archived since local midnight on the daemon's machine. */
  closedToday: z.number(),
  /** A brief is being written right now. */
  briefRunning: z.boolean(),
  updatedAt: z.string(),
});
export type HomeSnapshot = z.infer<typeof HomeSnapshotSchema>;

export const HOME_REQUEST_ACTIONS = [
  "get",
  "refresh",
  "snooze",
  "keep",
  "set_layout",
  "recent",
] as const;
export const HomeRequestActionSchema = z.enum(HOME_REQUEST_ACTIONS);
export type HomeRequestAction = z.infer<typeof HomeRequestActionSchema>;

/**
 * App, CLI and Chief to the daemon. `input` by action:
 * - get / refresh: none.
 * - snooze: {agentId, until: ISO | null} (null brings it back now).
 * - keep: {agentId, keep: boolean} (Sweep "Keep"; false releases it).
 * - set_layout: {layout: HomeLayout | null} (null = back to normal).
 * - recent: {offset, limit}: CLOSED (archived) sessions he wrote to, newest first, answered in
 *   `payload.recent` (the snapshot is null). Open ones are already in the app's store.
 */
export const HomeRequestSchema = z.object({
  type: z.literal("home.request"),
  requestId: z.string(),
  action: HomeRequestActionSchema,
  input: z.record(z.string(), z.unknown()).default({}),
});

/** One closed session in "Recently worked on" (the `recent` action). */
export const HomeRecentItemSchema = z.object({
  agentId: z.string(),
  /** card.title, else card.what, else the session title. */
  title: z.string(),
  workspaceId: z.string().nullable(),
  /** "Folder › Workspace" when known. */
  place: z.string().nullable(),
  lastUserMessageAt: z.string(),
  lastActivityAt: z.string(),
  archivedAt: z.string(),
});
export type HomeRecentItem = z.infer<typeof HomeRecentItemSchema>;

export const HomeRecentPageSchema = z.object({
  items: z.array(HomeRecentItemSchema),
  /** More closed sessions exist beyond offset + items.length. */
  hasMore: z.boolean(),
});
export type HomeRecentPage = z.infer<typeof HomeRecentPageSchema>;

export const HomeResponseSchema = z.object({
  type: z.literal("home.response"),
  payload: z.object({
    requestId: z.string(),
    snapshot: HomeSnapshotSchema.nullable(),
    /** Only for the `recent` action. */
    recent: HomeRecentPageSchema.optional(),
    error: z.string().nullable(),
  }),
});

/** Daemon to app, a subscribed fork event (FORK_SESSION_EVENTS): the full snapshot after any change. */
export const HomeUpdateMessageSchema = z.object({
  type: z.literal("home_update"),
  payload: HomeSnapshotSchema,
});

// ---------------------------------------------------------------------------------------------
// Snooze presets
// ---------------------------------------------------------------------------------------------

export type HomeSnoozePreset = "3h" | "tomorrow" | "nextweek";

/** 3 hours from now / tomorrow 09:00 / next Monday 09:00, in the machine's local time. */
export function resolveSnoozeUntil(preset: HomeSnoozePreset, now: Date): Date {
  if (preset === "3h") return new Date(now.getTime() + 3 * MS_PER_HOUR);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  if (preset === "tomorrow") {
    target.setDate(target.getDate() + 1);
    return target;
  }
  const daysToMonday = ((8 - target.getDay()) % 7) || 7;
  target.setDate(target.getDate() + daysToMonday);
  return target;
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

/** The slice of a session Home reads. App and server each map their own session type onto it. */
export interface HomeSessionInput {
  /** Unique key for the session (an agent id; the app may prefix the host). */
  id: string;
  /** The agent id the brief, snooze and layout files use. Defaults to `id`. */
  agentId?: string;
  title: string | null;
  state: SessionState;
  card: HomeCard | null | undefined;
  /** Epoch ms; 0 when unknown. */
  lastActivityAt: number;
  /** Epoch ms of the last message HE sent (cache-warm pings excluded by the daemon); 0/absent = none. */
  lastUserMessageAt?: number;
  folder: string | null;
  workspace: string | null;
}

export type HomeGroupName =
  | "now"
  | "today"
  | "later"
  | "snoozed"
  | "running"
  | "checkOn"
  | "kept"
  | "stopped"
  | "superseded";

export interface HomeEntry<T extends HomeSessionInput> {
  session: T;
  group: HomeGroupName;
  /** card.title, else card.what, else the session title. The next step is `card.nextStep`. */
  title: string;
  /** No card yet: the screen says "reading…". */
  reading: boolean;
  /** snoozed / kept: epoch ms the hold ends. */
  until: number | null;
}

export interface HomeTally {
  open: number;
  /** Waiting on him: the whole queue plus what he put off with Later. */
  waiting: number;
  running: number;
  stopped: number;
  /** Check on these + kept + superseded: finished or quiet, to look at or close. */
  toCheck: number;
  /** open minus the sum of every group; anything above 0 is a bug the screen must show. */
  gap: number;
}

export interface HomeResolvedLayout<T extends HomeSessionInput> {
  title: string;
  reason: string;
  createdAt: string;
  groups: { label: string; items: { entry: HomeEntry<T>; line: string | null }[] }[];
  /** Queue sessions the layout does not mention: shown collapsed under it, never dropped. */
  restOfQueue: HomeEntry<T>[];
}

export interface HomeView<T extends HomeSessionInput> {
  headline: string | null;
  since: string | null;
  generatedAt: string | null;
  queue: Record<HomeQueueGroup, HomeEntry<T>[]>;
  snoozed: HomeEntry<T>[];
  running: HomeEntry<T>[];
  /**
   * "Recently worked on": the sessions he last sent a message to, newest first, whatever their
   * importance (HOME_RECENT_LIMIT). An overlay like `layout`, not a group of the partition: a
   * session may be here and in the queue; this block is where he is, the queue is what to do.
   */
  recent: HomeEntry<T>[];
  /** Every open session he wrote to, newest first: `recent` is its first HOME_RECENT_LIMIT. */
  recentAll: HomeEntry<T>[];
  /** `running` without the sessions already shown in `recent`: what "Running now" lists. */
  runningElsewhere: HomeEntry<T>[];
  checkOn: HomeEntry<T>[];
  kept: HomeEntry<T>[];
  tidy: { stopped: HomeEntry<T>[]; superseded: HomeEntry<T>[] };
  layout: HomeResolvedLayout<T> | null;
  tally: HomeTally;
}

const URGENCY_RANK: Record<(typeof HOME_CARD_URGENCIES)[number], number> = {
  now: 0,
  today: 1,
  week: 2,
  whenever: 3,
};
const IMPORTANCE_RANK: Record<(typeof HOME_CARD_IMPORTANCES)[number], number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const URGENCY_GROUP: Record<(typeof HOME_CARD_URGENCIES)[number], HomeQueueGroup> = {
  now: "now",
  today: "today",
  week: "later",
  whenever: "later",
};

function agentIdOf(session: HomeSessionInput): string {
  return session.agentId ?? session.id;
}

/** Waits on him: the card says he must act and it is not already done. */
export function cardWaitsOnHim(card: HomeCard | null | undefined): boolean {
  return (
    Boolean(card) &&
    card!.waitingOn.trim().toLowerCase() === "nazmul" &&
    card!.kind !== "none" &&
    !card!.looksFinished
  );
}

function parseTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The item's name: the card's theme title; for a card written before titles existed, what it is
 * about; with no card, the session's own title. Never the first words of a prompt when a card
 * knows better.
 */
function entryTitle(session: HomeSessionInput): string {
  const card = session.card;
  return (
    card?.title?.trim() || card?.what?.trim() || session.title?.trim() || session.id.slice(0, 8)
  );
}

interface Classified {
  group: HomeGroupName;
  until: number | null;
}

function classify(
  session: HomeSessionInput,
  ctx: {
    now: number;
    snoozed: Record<string, string>;
    kept: Record<string, string>;
    superseded: ReadonlySet<string>;
    briefGroup: ReadonlyMap<string, HomeQueueGroup>;
  },
): Classified {
  const id = agentIdOf(session);
  const card = session.card;
  if (session.state === "working") return { group: "running", until: null };

  const waits = session.state === "needs_you" || cardWaitsOnHim(card);
  const stopped = session.state === "stopped" || (card?.stopped === true && !waits);
  if (ctx.superseded.has(id) && session.state !== "needs_you") {
    return { group: "superseded", until: null };
  }
  if (stopped && !waits) return { group: "stopped", until: null };

  if (waits) {
    const snoozedUntil = parseTime(ctx.snoozed[id]);
    if (snoozedUntil !== null && snoozedUntil > ctx.now) {
      return { group: "snoozed", until: snoozedUntil };
    }
    const fromBrief = ctx.briefGroup.get(id);
    if (fromBrief) return { group: fromBrief, until: null };
    if (session.state === "needs_you" && !card) return { group: "now", until: null };
    return { group: card ? URGENCY_GROUP[card.urgency] : "later", until: null };
  }

  // Quiet: finished, or nothing asked. Sweep "Keep" hides it for a week, until it moves again.
  const keptUntil = parseTime(ctx.kept[id]);
  if (keptUntil !== null && keptUntil > ctx.now) {
    const keptAt = keptUntil - HOME_KEEP_DAYS * MS_PER_DAY;
    if (session.lastActivityAt <= keptAt) return { group: "kept", until: keptUntil };
  }
  return { group: "checkOn", until: null };
}

function indexOfIds(ids: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, index) => {
    if (!map.has(id)) map.set(id, index);
  });
  return map;
}

function urgencyRankOf(session: HomeSessionInput): number {
  // A pending permission blocks an agent right now, card or no card.
  if (session.state === "needs_you") return -1;
  return session.card ? URGENCY_RANK[session.card.urgency] : 4;
}

function ruleOrder<T extends HomeSessionInput>(a: HomeEntry<T>, b: HomeEntry<T>): number {
  const cardA = a.session.card;
  const cardB = b.session.card;
  return (
    urgencyRankOf(a.session) - urgencyRankOf(b.session) ||
    (cardA ? IMPORTANCE_RANK[cardA.importance] : 3) -
      (cardB ? IMPORTANCE_RANK[cardB.importance] : 3) ||
    b.session.lastActivityAt - a.session.lastActivityAt
  );
}

function sortedBy<T extends HomeSessionInput>(
  entries: HomeEntry<T>[],
  briefOrder: ReadonlyMap<string, number>,
): HomeEntry<T>[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ia = briefOrder.get(agentIdOf(a.entry.session)) ?? Number.POSITIVE_INFINITY;
      const ib = briefOrder.get(agentIdOf(b.entry.session)) ?? Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia < ib ? -1 : 1;
      return ruleOrder(a.entry, b.entry) || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function byRecent<T extends HomeSessionInput>(entries: HomeEntry<T>[]): HomeEntry<T>[] {
  return [...entries].sort((a, b) => b.session.lastActivityAt - a.session.lastActivityAt);
}

/** The groups of a view, as `computeHomeTally` reads them. */
export interface HomeGroups<T extends HomeSessionInput> {
  queue: Record<HomeQueueGroup, readonly HomeEntry<T>[]>;
  snoozed: readonly HomeEntry<T>[];
  running: readonly HomeEntry<T>[];
  checkOn: readonly HomeEntry<T>[];
  kept: readonly HomeEntry<T>[];
  tidy: { stopped: readonly HomeEntry<T>[]; superseded: readonly HomeEntry<T>[] };
}

/**
 * The tally line's numbers. `gap` = open minus everything the groups hold: the screen must show
 * it when above 0 ("N not placed") instead of silently hiding sessions.
 */
export function computeHomeTally<T extends HomeSessionInput>(
  open: number,
  groups: HomeGroups<T>,
): HomeTally {
  const queued = groups.queue.now.length + groups.queue.today.length + groups.queue.later.length;
  const grouped =
    queued +
    groups.snoozed.length +
    groups.running.length +
    groups.checkOn.length +
    groups.kept.length +
    groups.tidy.stopped.length +
    groups.tidy.superseded.length;
  return {
    open,
    waiting: queued + groups.snoozed.length,
    running: groups.running.length,
    stopped: groups.tidy.stopped.length,
    toCheck: groups.checkOn.length + groups.kept.length + groups.tidy.superseded.length,
    gap: open - grouped,
  };
}

/**
 * The one definition of what Home shows. Pure: the screen and `home_get` call it with their own
 * session lists. `sessions` must already be the open ones (not archived, not internal).
 */
export function buildHomeView<T extends HomeSessionInput>(input: {
  sessions: readonly T[];
  brief: HomeBrief | null;
  state: HomeState;
  now?: number;
}): HomeView<T> {
  const now = input.now ?? Date.now();
  const { brief, state } = input;
  const briefGroup = new Map<string, HomeQueueGroup>();
  for (const item of brief?.queue ?? []) {
    if (!briefGroup.has(item.id)) briefGroup.set(item.id, item.group);
  }
  const ctx = {
    now,
    snoozed: state.snoozed,
    kept: state.kept,
    superseded: new Set(brief?.superseded ?? []),
    briefGroup,
  };

  const entries: HomeEntry<T>[] = input.sessions.map((session) => {
    const { group, until } = classify(session, ctx);
    return { session, group, title: entryTitle(session), reading: !session.card, until };
  });
  const inGroup = (group: HomeGroupName) => entries.filter((entry) => entry.group === group);

  const queueOrder = indexOfIds((brief?.queue ?? []).map((item) => item.id));
  const checkOrder = indexOfIds(brief?.checkOn ?? []);
  const queue: Record<HomeQueueGroup, HomeEntry<T>[]> = {
    now: sortedBy(inGroup("now"), queueOrder),
    today: sortedBy(inGroup("today"), queueOrder),
    later: sortedBy(inGroup("later"), queueOrder),
  };
  const snoozed = inGroup("snoozed").sort((a, b) => (a.until ?? 0) - (b.until ?? 0));
  const running = byRecent(inGroup("running"));
  const checkOn = sortedBy(inGroup("checkOn"), checkOrder);
  const kept = byRecent(inGroup("kept"));
  const tidy = { stopped: byRecent(inGroup("stopped")), superseded: byRecent(inGroup("superseded")) };

  const tally = computeHomeTally(input.sessions.length, {
    queue,
    snoozed,
    running,
    checkOn,
    kept,
    tidy,
  });

  const recentAll = entries
    .filter((entry) => (entry.session.lastUserMessageAt ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.session.lastUserMessageAt ?? 0) - (a.session.lastUserMessageAt ?? 0) ||
        b.session.lastActivityAt - a.session.lastActivityAt,
    );
  const recent = recentAll.slice(0, HOME_RECENT_LIMIT);
  const recentIds = new Set(recent.map((entry) => entry.session.id));

  return {
    headline: brief?.headline ?? null,
    since: brief?.since ?? null,
    generatedAt: brief?.generatedAt ?? null,
    queue,
    snoozed,
    running,
    recent,
    recentAll,
    runningElsewhere: running.filter((entry) => !recentIds.has(entry.session.id)),
    checkOn,
    kept,
    tidy,
    layout: resolveHomeLayout(state.chiefLayout, entries, [...queue.now, ...queue.today, ...queue.later]),
    tally,
  };
}

/**
 * Chief's layout: ids that no longer exist are dropped, an empty result is no layout, and queue
 * sessions the layout leaves out stay reachable under it.
 */
function resolveHomeLayout<T extends HomeSessionInput>(
  layout: HomeLayout | null,
  entries: readonly HomeEntry<T>[],
  queue: readonly HomeEntry<T>[],
): HomeResolvedLayout<T> | null {
  if (!layout) return null;
  const byAgent = new Map(entries.map((entry) => [agentIdOf(entry.session), entry]));
  const used = new Set<string>();
  const groups = layout.groups
    .map((group) => ({
      label: group.label,
      items: group.items.flatMap((item) => {
        const entry = byAgent.get(item.agentId);
        if (!entry || used.has(item.agentId)) return [];
        used.add(item.agentId);
        return [{ entry, line: item.line?.trim() || null }];
      }),
    }))
    .filter((group) => group.items.length > 0);
  if (groups.length === 0) return null;
  return {
    title: layout.title,
    reason: layout.reason,
    createdAt: layout.createdAt,
    groups,
    restOfQueue: queue.filter((entry) => !used.has(agentIdOf(entry.session))),
  };
}

/** Trims a layout Chief wrote to what the screen will draw: bounded, no empty groups, no duplicates. */
export function normalizeHomeLayout(layout: HomeLayout): HomeLayout {
  const seen = new Set<string>();
  let remaining = HOME_LAYOUT_MAX_ITEMS;
  const groups: HomeLayout["groups"] = [];
  for (const group of layout.groups.slice(0, HOME_LAYOUT_MAX_GROUPS)) {
    const items = [];
    for (const item of group.items) {
      if (remaining <= 0) break;
      if (!item.agentId || seen.has(item.agentId)) continue;
      seen.add(item.agentId);
      remaining -= 1;
      const line = item.line?.trim().slice(0, 160);
      items.push(line ? { agentId: item.agentId, line } : { agentId: item.agentId });
    }
    if (items.length > 0) groups.push({ label: group.label.trim().slice(0, 60), items });
  }
  return {
    title: layout.title.trim().slice(0, 80),
    reason: layout.reason.trim().slice(0, 120),
    createdAt: layout.createdAt,
    groups,
  };
}

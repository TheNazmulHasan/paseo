// Home v2 (fork mod, home-map): small pure helpers between `buildHomeView` and the screen, so the
// wording rules, numbering and clipping are tested without rendering anything.
import type { HomeEntry, HomeTally, HomeView } from "@getpaseo/protocol/home";
import type { SessionState } from "@getpaseo/protocol/session-state";
import type { HomeSession } from "./model";

export type HomeSessionEntry = HomeEntry<HomeSession>;
export type HomeSessionView = HomeView<HomeSession>;

/** Check on these shows this many rows; the rest sit behind "Sweep them". */
export const CHECK_ON_VISIBLE = 4;
/** Not started shows this many backlog tasks. */
export const BACKLOG_VISIBLE = 3;
/** The Chief reply line is clipped to this many characters. */
export const REPLY_LINE_MAX = 140;

export type HomeDotKind = "waiting" | "running" | "ring";

/**
 * Home v2 draws at most two dot colours: amber = waits on him, blue = running. Everything else
 * (finished, stopped, parked) is a hollow ring, so colour never competes with the urgency tint.
 */
export function dotKindFor(state: SessionState, waiting: boolean): HomeDotKind {
  if (state === "working") return "running";
  if (waiting || state === "needs_you") return "waiting";
  return "ring";
}

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

export interface TallyBar {
  /** Percent of the bar, 0..100; the three add up to 100 (or all 0 with no sessions). */
  waiting: number;
  running: number;
  rest: number;
}

/** The thin bar under the tally: waiting amber, running blue, everything else grey. */
export function computeTallyBar(tally: HomeTally): TallyBar {
  if (tally.open <= 0) return { waiting: 0, running: 0, rest: 0 };
  const share = (count: number) => Math.min(100, Math.max(0, (count / tally.open) * 100));
  const waiting = share(tally.waiting);
  const running = Math.min(share(tally.running), 100 - waiting);
  return { waiting, running, rest: Math.max(0, 100 - waiting - running) };
}

export type FallbackHeadline =
  | { key: "empty"; count: 0 }
  | { key: "clear"; count: number }
  | { key: "waiting"; count: number };

/** The plain sentence shown while Haiku has written no brief yet; computed from the tally only. */
export function fallbackHeadline(tally: HomeTally): FallbackHeadline {
  if (tally.open === 0) return { key: "empty", count: 0 };
  if (tally.waiting === 0) return { key: "clear", count: tally.open };
  return { key: "waiting", count: tally.waiting };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "08:31" in the machine's local time; null when the time is missing or unreadable. */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}

export type SnoozeBack =
  | { kind: "today"; time: string }
  | { kind: "tomorrow"; time: string }
  | { kind: "date"; time: string; date: Date };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** When the earliest put-off session comes back: "today 15:00", "tomorrow 09:00", or a date. */
export function describeSnoozeBack(untilMs: number, now: Date): SnoozeBack {
  const until = new Date(untilMs);
  const time = `${pad2(until.getHours())}:${pad2(until.getMinutes())}`;
  const days = Math.round((startOfDay(until) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return { kind: "today", time };
  if (days === 1) return { kind: "tomorrow", time };
  return { kind: "date", time, date: until };
}

// ---------------------------------------------------------------------------------------------
// Queue numbering
// ---------------------------------------------------------------------------------------------

export type QueueTint = "now" | "today" | "none";

export interface QueueItemModel {
  entry: HomeSessionEntry;
  /** 1-based; counts straight on across the groups, the collapsed one included. */
  number: number;
  /** The one line Chief wrote for this item in its layout; null in the default queue. */
  line: string | null;
}

export interface QueueBlock {
  key: string;
  /** Chief's group label; null in the default queue (the tint says Now / Today). */
  label: string | null;
  tint: QueueTint;
  items: QueueItemModel[];
}

export interface QueueModel {
  mode: "queue" | "layout";
  /** The always-visible groups. */
  blocks: QueueBlock[];
  /** "N more can wait" (default) or "N more waiting on you" (Chief's layout): collapsed. */
  collapsed: QueueBlock | null;
  /** Layout only: the title and reason Chief gave it. */
  layout: { title: string; reason: string; createdAt: string } | null;
}

const LAYOUT_TINTS: readonly QueueTint[] = ["now", "today"];

/**
 * The queue as numbered blocks. Default: Now (strong tint), Today (faint), and the `later` group
 * collapsed. With a Chief layout: its groups in order (first strongest, second faint, the rest
 * plain) and the queue sessions it did not mention collapsed under it. Numbers run through all of
 * it, so item 7 is item 7 whether its block is open or not.
 */
export function buildQueueModel(view: Pick<HomeSessionView, "queue" | "layout">): QueueModel {
  let count = 0;
  const number = (
    entries: readonly { entry: HomeSessionEntry; line: string | null }[],
  ): QueueItemModel[] =>
    entries.map(({ entry, line }) => {
      count += 1;
      return { entry, number: count, line };
    });
  const plain = (entries: readonly HomeSessionEntry[]) =>
    entries.map((entry) => ({ entry, line: null as string | null }));

  if (view.layout) {
    const blocks = view.layout.groups.map((group, index) => ({
      key: `layout:${index}`,
      label: group.label,
      tint: LAYOUT_TINTS[index] ?? ("none" as QueueTint),
      items: number(group.items),
    }));
    const rest = view.layout.restOfQueue;
    return {
      mode: "layout",
      blocks,
      collapsed:
        rest.length > 0
          ? { key: "rest", label: null, tint: "none", items: number(plain(rest)) }
          : null,
      layout: {
        title: view.layout.title,
        reason: view.layout.reason,
        createdAt: view.layout.createdAt,
      },
    };
  }

  const blocks: QueueBlock[] = [];
  for (const section of ["now", "today"] as const) {
    const entries = view.queue[section];
    if (entries.length === 0) continue;
    blocks.push({ key: section, label: null, tint: section, items: number(plain(entries)) });
  }
  const later = view.queue.later;
  return {
    mode: "queue",
    blocks,
    collapsed:
      later.length > 0
        ? { key: "later", label: null, tint: "none", items: number(plain(later)) }
        : null,
    layout: null,
  };
}

/** The numbered items that are on screen, in number order: what keys 1-9 reach. */
export function visibleQueueItems(model: QueueModel, collapsedOpen: boolean): QueueItemModel[] {
  const items = model.blocks.flatMap((block) => block.items);
  return collapsedOpen && model.collapsed ? [...items, ...model.collapsed.items] : items;
}

/** Whether the item has Later and Close (a layout item that is not from the rest has only Open). */
export function itemHasActions(model: QueueModel, item: QueueItemModel): boolean {
  if (model.mode === "queue") return true;
  return model.collapsed?.items.includes(item) ?? false;
}

// ---------------------------------------------------------------------------------------------
// Text of an item
// ---------------------------------------------------------------------------------------------

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface ItemText {
  /** Bold name: `entry.title` (card title, else what, else the session title). */
  name: string;
  /** The action he must take (queue and layout items only). */
  nextStep: string | null;
  /** Where it stands, one sentence. */
  status: string | null;
  /** Why it is urgent. */
  why: string | null;
}

/**
 * What an item says. Name = `entry.title`. The next step is its own plain line (queue and layout
 * items only), then the status, then why; a line that repeats the name or another line is left out.
 */
export function describeItem(
  entry: HomeSessionEntry,
  options: { withNextStep: boolean; withWhy: boolean; layoutLine?: string | null },
): ItemText {
  const card = entry.session.card;
  const name = entry.title;
  const seen = new Set([name.toLowerCase()]);
  const take = (value: string | null): string | null => {
    if (!value) return null;
    const key = value.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return value;
  };
  const nextStep = options.withNextStep ? take(clean(card?.nextStep)) : null;
  const status = take(clean(card?.status));
  const why = options.withWhy ? take(clean(options.layoutLine) ?? clean(card?.why)) : null;
  return { name, nextStep, status, why };
}

// ---------------------------------------------------------------------------------------------
// Check on these, Tidy
// ---------------------------------------------------------------------------------------------

export function splitCheckOn(
  checkOn: readonly HomeSessionEntry[],
  visible: number = CHECK_ON_VISIBLE,
): { shown: HomeSessionEntry[]; more: number } {
  return { shown: checkOn.slice(0, visible), more: Math.max(0, checkOn.length - visible) };
}

export interface TidyModel {
  stopped: HomeSessionEntry[];
  superseded: HomeSessionEntry[];
  /** Every session "Close them" archives, once each. */
  all: HomeSessionEntry[];
}

export function describeTidy(view: Pick<HomeSessionView, "tidy">): TidyModel {
  const all: HomeSessionEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...view.tidy.stopped, ...view.tidy.superseded]) {
    if (seen.has(entry.session.id)) continue;
    seen.add(entry.session.id);
    all.push(entry);
  }
  return { stopped: view.tidy.stopped, superseded: view.tidy.superseded, all };
}

// ---------------------------------------------------------------------------------------------
// Chief reply line
// ---------------------------------------------------------------------------------------------

/** Markdown noise that makes a one-line preview unreadable. */
function stripMarkdownNoise(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/** The first non-empty line of Chief's reply, without markdown marks, clipped with "…". */
export function clipReplyLine(text: string | null, max: number = REPLY_LINE_MAX): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripMarkdownNoise(raw);
    if (!line || /^[-=*_]{3,}$/.test(line)) continue;
    if (line.length <= max) return line;
    return `${line.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  }
  return null;
}

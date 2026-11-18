import {
  buildHomeView,
  type HomeEntry,
  type HomeSessionInput,
  type HomeSnapshot,
  type HomeView,
} from "@getpaseo/protocol/home";

import type { SessionStateRow } from "../chief/session-rows.js";

/**
 * Nazmul mod (home-map): "exactly what Home shows", for Chief and the CLI. The same
 * `buildHomeView` the screen calls, over the daemon's own session rows, then flattened to plain
 * JSON (no card internals Chief does not need). Pure.
 */

export interface HomeRowSession extends HomeSessionInput {
  link: string | null;
}

function ms(iso: string | null | undefined): number {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function rowToHomeSession(row: SessionStateRow): HomeRowSession {
  return {
    id: row.agentId,
    title: row.title,
    state: row.state,
    card: row.card,
    lastActivityAt: ms(row.lastActivityAt),
    lastUserMessageAt: ms(row.lastUserMessageAt),
    folder: row.folder,
    workspace: row.workspaceTitle,
    link: row.link,
  };
}

export interface HomeItem {
  agentId: string;
  title: string;
  nextStep: string | null;
  status: string | null;
  why: string | null;
  waitingOn: string | null;
  urgency: string | null;
  importance: string | null;
  looksFinished: boolean;
  reading: boolean;
  folder: string | null;
  workspace: string | null;
  lastActivityAt: string | null;
  /** Snoozed and kept items: when the hold ends. */
  until: string | null;
  /** Markdown link that opens the session. */
  link: string | null;
}

function item(entry: HomeEntry<HomeRowSession>): HomeItem {
  const { session, title, reading, until } = entry;
  const card = session.card;
  return {
    agentId: session.id,
    title,
    nextStep: card?.nextStep ?? null,
    status: card?.status ?? null,
    why: card?.why ?? null,
    waitingOn: card?.waitingOn ?? null,
    urgency: card?.urgency ?? null,
    importance: card?.importance ?? null,
    looksFinished: card?.looksFinished ?? false,
    reading,
    folder: session.folder,
    workspace: session.workspace,
    lastActivityAt: session.lastActivityAt > 0 ? new Date(session.lastActivityAt).toISOString() : null,
    until: until ? new Date(until).toISOString() : null,
    link: session.link,
  };
}

export function describeHomeView(view: HomeView<HomeRowSession>, snapshot: HomeSnapshot) {
  const items = (entries: readonly HomeEntry<HomeRowSession>[]) => entries.map(item);
  return {
    headline: view.headline,
    since: view.since,
    briefGeneratedAt: view.generatedAt,
    briefRunning: snapshot.briefRunning,
    closedToday: snapshot.closedToday,
    tally: view.tally,
    queue: {
      now: items(view.queue.now),
      today: items(view.queue.today),
      later: items(view.queue.later),
    },
    snoozed: items(view.snoozed),
    recentlyWorkedOn: items(view.recent),
    running: items(view.runningElsewhere),
    checkOn: items(view.checkOn),
    kept: items(view.kept),
    tidy: { stopped: items(view.tidy.stopped), superseded: items(view.tidy.superseded) },
    chiefLayout: view.layout
      ? {
          title: view.layout.title,
          reason: view.layout.reason,
          createdAt: view.layout.createdAt,
          groups: view.layout.groups.map((group) => ({
            label: group.label,
            items: group.items.map(({ entry, line }) => ({ ...item(entry), line })),
          })),
          restOfQueue: items(view.layout.restOfQueue),
        }
      : null,
  };
}

export function buildHomeGet(input: {
  rows: readonly SessionStateRow[];
  snapshot: HomeSnapshot;
  now?: number;
}) {
  const view = buildHomeView({
    // The Chief agent has its own bar on Home, so it is not one of the sessions (the screen skips it too).
    sessions: input.rows.filter((row) => !row.chief).map(rowToHomeSession),
    brief: input.snapshot.brief,
    state: input.snapshot.state,
    now: input.now,
  });
  return describeHomeView(view, input.snapshot);
}

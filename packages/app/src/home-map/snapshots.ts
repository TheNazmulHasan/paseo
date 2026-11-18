// Home v2 (fork mod, home-map): several hosts, one Home. Each daemon holds its own brief and
// state for its own sessions (agent ids are unique across hosts), so the screen merges the
// per-host snapshots into one brief/state pair and runs `buildHomeView` over every session once.
import {
  EMPTY_HOME_STATE,
  type HomeBrief,
  type HomeLayout,
  type HomeSnapshot,
  type HomeState,
} from "@getpaseo/protocol/home";

export interface MergedHomeSnapshot {
  brief: HomeBrief | null;
  state: HomeState;
  /** Sum over the hosts that answered; null when no host did (the local count takes over). */
  closedToday: number | null;
  briefRunning: boolean;
  /** Hosts whose snapshot is in. */
  hostCount: number;
}

function parseTime(iso: string | undefined | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Merges the hosts' snapshots.
 * - Headline, since and generatedAt come from the host that has a brief and the most open
 *   sessions (ties: the newer brief, then the lower server id, so the pick never flickers).
 * - queue, checkOn and superseded are concatenated, the primary host's entries first.
 * - snoozed and kept are merged (ids are unique per host). The chief layout is the newest one.
 */
export function mergeHomeSnapshots(
  snapshots: Readonly<Record<string, HomeSnapshot | undefined>>,
  openByHost: Readonly<Record<string, number>>,
): MergedHomeSnapshot {
  const hosts = Object.keys(snapshots)
    .filter((serverId) => snapshots[serverId])
    .sort();
  if (hosts.length === 0) {
    return {
      brief: null,
      state: EMPTY_HOME_STATE,
      closedToday: null,
      briefRunning: false,
      hostCount: 0,
    };
  }

  const withBrief = hosts.filter((serverId) => snapshots[serverId]?.brief);
  const primary =
    [...withBrief].sort(
      (a, b) =>
        (openByHost[b] ?? 0) - (openByHost[a] ?? 0) ||
        parseTime(snapshots[b]?.brief?.generatedAt) - parseTime(snapshots[a]?.brief?.generatedAt),
    )[0] ?? null;

  let brief: HomeBrief | null = null;
  if (primary) {
    const lead = snapshots[primary]?.brief as HomeBrief;
    const ordered = [primary, ...withBrief.filter((serverId) => serverId !== primary)];
    brief = {
      ...lead,
      queue: ordered.flatMap((serverId) => snapshots[serverId]?.brief?.queue ?? []),
      checkOn: ordered.flatMap((serverId) => snapshots[serverId]?.brief?.checkOn ?? []),
      superseded: ordered.flatMap((serverId) => snapshots[serverId]?.brief?.superseded ?? []),
    };
  }

  const snoozed: Record<string, string> = {};
  const kept: Record<string, string> = {};
  let layout: HomeLayout | null = null;
  for (const serverId of hosts) {
    const state = snapshots[serverId]?.state;
    if (!state) continue;
    Object.assign(snoozed, state.snoozed);
    Object.assign(kept, state.kept);
    if (
      state.chiefLayout &&
      (!layout || parseTime(state.chiefLayout.createdAt) > parseTime(layout.createdAt))
    ) {
      layout = state.chiefLayout;
    }
  }

  return {
    brief,
    state: { snoozed, kept, chiefLayout: layout },
    closedToday: hosts.reduce((sum, serverId) => sum + (snapshots[serverId]?.closedToday ?? 0), 0),
    briefRunning: hosts.some((serverId) => snapshots[serverId]?.briefRunning === true),
    hostCount: hosts.length,
  };
}

/** The hosts that hold a Chief layout right now: "Back to normal" is sent to each of them. */
export function hostsWithLayout(
  snapshots: Readonly<Record<string, HomeSnapshot | undefined>>,
): string[] {
  return Object.keys(snapshots)
    .filter((serverId) => snapshots[serverId]?.state.chiefLayout)
    .sort();
}

/** The local-day key used by the "closed today" fallback counter, e.g. "2026-11-18". */
export function localDayKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * What "closed today" shows. The daemons count archives since their local midnight; when none has
 * answered (an older daemon, or not connected yet) the count of closes made from Home today stands in.
 */
export function resolveClosedToday(input: {
  merged: number | null;
  local: { day: string; count: number };
  today: string;
}): number {
  if (input.merged !== null) return input.merged;
  return input.local.day === input.today ? input.local.count : 0;
}

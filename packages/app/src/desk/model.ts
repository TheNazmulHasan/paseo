// Desk (fork mod #12): the working set between Pinned (permanent) and the Shelf (everything).
// Everything here is pure so the sidebar projection, the store hook, the switcher and the tests
// share one definition of "which workspace is where".
import { buildStatusGroups, type StatusBucket } from "@/hooks/sidebar-status-view-model";
import { sortSidebarWorkspacesByRecentActivity } from "@/hooks/sidebar-workspaces-view-model";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";

export type DeskGrouping = "recent" | "project" | "status";

export const DEFAULT_DESK_GROUPING: DeskGrouping = "recent";
export const DESK_SEED_LIMIT = 12;
export const DESK_SEED_RECENT_MS = 48 * 60 * 60 * 1000;

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** What a folded Shelf hands the existing lists in place of their rows; one identity, no churn. */
export const EMPTY_SHELF: never[] = [];

/** Same `<serverId>:<workspaceId>` key the sidebar, tabs and the switcher already use. */
export function deskServerIdOfKey(workspaceKey: string): string {
  return workspaceKey.slice(0, workspaceKey.lastIndexOf(":"));
}

// ---------------------------------------------------------------------------------------------
// Sync: first-run seed, new-workspace detection, pruning
// ---------------------------------------------------------------------------------------------

export interface DeskSyncState {
  deskKeys: readonly string[];
  /** Every workspace key the Desk has already made a decision about (on the Desk or not). */
  seenKeys: readonly string[];
  /** Hosts whose workspace list was baselined; only these can produce "new" workspaces. */
  seenHosts: readonly string[];
  seeded: boolean;
}

export interface DeskWorkspaceFact {
  workspaceKey: string;
  serverId: string;
  pinned: boolean;
  statusBucket: StatusBucket | null;
  statusEnteredAt: Date | null;
}

export const EMPTY_DESK_SYNC_STATE: DeskSyncState = {
  deskKeys: [],
  seenKeys: [],
  seenHosts: [],
  seeded: false,
};

function seedPriority(fact: DeskWorkspaceFact): number {
  return fact.statusEnteredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

/**
 * First run: the non-pinned workspaces that are alive (anything but Done) or were active in the
 * last 48h, freshest first, capped. Everything else is "seen" and stays on the Shelf.
 */
export function pickDeskSeed(input: {
  workspaces: readonly DeskWorkspaceFact[];
  now: number;
  limit?: number;
  recentMs?: number;
}): string[] {
  const limit = input.limit ?? DESK_SEED_LIMIT;
  const recentMs = input.recentMs ?? DESK_SEED_RECENT_MS;
  const candidates = input.workspaces.filter((fact) => {
    if (fact.pinned) {
      return false;
    }
    if (fact.statusBucket !== null && fact.statusBucket !== "done") {
      return true;
    }
    const enteredAt = fact.statusEnteredAt?.getTime();
    return enteredAt !== undefined && input.now - enteredAt <= recentMs;
  });
  return candidates
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => seedPriority(b.fact) - seedPriority(a.fact) || a.index - b.index)
    .slice(0, limit)
    .map(({ fact }) => fact.workspaceKey);
}

/**
 * Moves the Desk forward given the live workspace list.
 *
 * - Not seeded yet: wait until some host has loaded, then seed once.
 * - A workspace key that appears for an already-baselined host is new, so it goes on the Desk.
 * - A host seen for the first time (it connected late) is baselined: all its keys become "seen"
 *   without touching the Desk, so a late host never floods the Desk.
 * - Keys are never dropped when a workspace goes missing; only live workspaces render, so a
 *   key that comes back keeps its section. The lists are capped so they cannot grow forever.
 *
 * Returns the same `state` object when nothing changed.
 */
const DESK_KEYS_LIMIT = 500;
const SEEN_KEYS_LIMIT = 5000;

export function reconcileDesk(input: {
  state: DeskSyncState;
  workspaces: readonly DeskWorkspaceFact[];
  /** Hosts whose workspace list has loaded, even when that list is empty. */
  loadedServerIds: ReadonlySet<string>;
  now: number;
}): DeskSyncState {
  const { state, workspaces, now } = input;
  const loadedServerIds = new Set(input.loadedServerIds);
  for (const fact of workspaces) {
    loadedServerIds.add(fact.serverId);
  }
  if (loadedServerIds.size === 0) {
    return state;
  }

  const liveByServer = new Map<string, Set<string>>();
  for (const fact of workspaces) {
    let live = liveByServer.get(fact.serverId);
    if (!live) {
      live = new Set();
      liveByServer.set(fact.serverId, live);
    }
    live.add(fact.workspaceKey);
  }

  if (!state.seeded) {
    const deskKeys = pickDeskSeed({ workspaces, now });
    const seenKeys = workspaces.map((fact) => fact.workspaceKey);
    return { deskKeys, seenKeys, seenHosts: [...loadedServerIds], seeded: true };
  }

  const seenHosts = new Set(state.seenHosts);
  const seenKeys = new Set(state.seenKeys);
  const deskKeys = new Set(state.deskKeys);
  let changed = false;

  for (const serverId of loadedServerIds) {
    const live = liveByServer.get(serverId) ?? new Set<string>();
    const baseline = !seenHosts.has(serverId);
    if (baseline) {
      seenHosts.add(serverId);
      changed = true;
    }
    for (const key of live) {
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      changed = true;
      if (!baseline) {
        deskKeys.add(key);
      }
    }
    // Nothing is forgotten when a key goes missing: a list can drop a workspace for a moment
    // (reconnect, partial refresh), and forgetting it would re-add it as "new" (Shelf → Desk)
    // or lose its Desk place. Rendering shows live workspaces only, so stale keys are inert.
  }

  if (!changed) {
    return state;
  }
  return {
    deskKeys: [...deskKeys].slice(-DESK_KEYS_LIMIT),
    seenKeys: [...seenKeys].slice(-SEEN_KEYS_LIMIT),
    seenHosts: [...seenHosts],
    seeded: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Partition: Pinned / Desk / Shelf
// ---------------------------------------------------------------------------------------------

export interface DeskPartition<T> {
  pinned: T[];
  desk: T[];
  shelf: T[];
}

/** A workspace is in exactly one section; Pinned wins, then Desk, then the Shelf. */
export function partitionDeskWorkspaces<T extends { workspaceKey: string }>(input: {
  workspaces: readonly T[];
  pinnedKeys: ReadonlySet<string>;
  deskKeys: ReadonlySet<string>;
}): DeskPartition<T> {
  const result: DeskPartition<T> = { pinned: [], desk: [], shelf: [] };
  for (const workspace of input.workspaces) {
    if (input.pinnedKeys.has(workspace.workspaceKey)) {
      result.pinned.push(workspace);
    } else if (input.deskKeys.has(workspace.workspaceKey)) {
      result.desk.push(workspace);
    } else {
      result.shelf.push(workspace);
    }
  }
  return result;
}

export interface DeskProjectSplit {
  /** The projects without their Desk workspaces; the same array when nothing moved. */
  shelfProjects: SidebarProjectEntry[];
  deskPlacements: SidebarWorkspacePlacement[];
  /** Workspaces left on the Shelf. */
  shelfCount: number;
}

/**
 * Takes the Desk workspaces out of the (already unpinned) projects. A project keeps its header
 * even when every workspace moved, because the project row owns its new-workspace actions.
 */
export function splitDeskFromProjects(
  projects: SidebarProjectEntry[],
  deskKeys: ReadonlySet<string>,
): DeskProjectSplit {
  const deskPlacements: SidebarWorkspacePlacement[] = [];
  let shelfCount = 0;
  let changed = false;
  const shelfProjects = projects.map((project) => {
    const shelf = deskKeys.size
      ? project.workspaces.filter((workspace) => {
          if (deskKeys.has(workspace.workspaceKey)) {
            deskPlacements.push(workspace);
            return false;
          }
          return true;
        })
      : project.workspaces;
    shelfCount += shelf.length;
    if (shelf.length === project.workspaces.length) {
      return project;
    }
    changed = true;
    return { ...project, workspaces: shelf };
  });
  return {
    shelfProjects: changed ? shelfProjects : projects,
    deskPlacements,
    shelfCount,
  };
}

// ---------------------------------------------------------------------------------------------
// Desk rows and grouping
// ---------------------------------------------------------------------------------------------

export interface DeskGroup {
  key: string;
  /** Null for the flat Recent list, which has no group header. */
  label: string | null;
  bucket: StatusBucket | null;
  rows: SidebarWorkspaceEntry[];
}

/** Entries for the Desk's placements, freshest activity first (the "Recent" signal). */
export function buildDeskRows(input: {
  deskPlacements: readonly SidebarWorkspacePlacement[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): SidebarWorkspaceEntry[] {
  const entries = input.deskPlacements.flatMap((placement) => {
    const entry = input.workspaceEntriesByKey.get(placement.workspaceKey);
    return entry ? [entry] : [];
  });
  return sortSidebarWorkspacesByRecentActivity({
    workspaces: entries,
    workspaceEntriesByKey: input.workspaceEntriesByKey,
  });
}

export function buildDeskGroups(input: {
  rows: readonly SidebarWorkspaceEntry[];
  grouping: DeskGrouping;
  projectNamesByViewKey: Map<string, string>;
}): DeskGroup[] {
  const { rows, grouping } = input;
  if (rows.length === 0) {
    return [];
  }
  switch (grouping) {
    case "recent":
      return [{ key: "recent", label: null, bucket: null, rows: [...rows] }];
    case "status":
      return buildStatusGroups([...rows], input.projectNamesByViewKey).map((group) => ({
        key: group.bucket,
        label: group.label,
        bucket: group.bucket,
        rows: group.rows,
      }));
    case "project": {
      // Rows arrive freshest first, so first appearance orders the projects by their freshest row.
      const byProject = new Map<string, DeskGroup>();
      for (const row of rows) {
        let group = byProject.get(row.projectViewKey);
        if (!group) {
          group = {
            key: row.projectViewKey,
            label: input.projectNamesByViewKey.get(row.projectViewKey) ?? row.projectName,
            bucket: null,
            rows: [],
          };
          byProject.set(row.projectViewKey, group);
        }
        group.rows.push(row);
      }
      return [...byProject.values()];
    }
  }
}

/** Display order, flattened: what the Cmd+1..9 jump numbers walk. */
export function flattenDeskGroups(groups: readonly DeskGroup[]): SidebarWorkspaceEntry[] {
  return groups.flatMap((group) => group.rows);
}

/** Desk workspaces whose status is Done: what "Clear desk" sends back to the Shelf. */
export function selectClearableDeskKeys(input: {
  deskKeys: readonly string[];
  statusBucketByKey: ReadonlyMap<string, StatusBucket>;
}): string[] {
  return input.deskKeys.filter((key) => input.statusBucketByKey.get(key) === "done");
}

// ---------------------------------------------------------------------------------------------
// Switcher ordering
// ---------------------------------------------------------------------------------------------

/**
 * Keeps the first `headCount` keys where they are (row 0 = current, row 1 = the workspace just
 * left, so a tap still lands there), then lists Desk workspaces before the rest. Each group keeps
 * its incoming (MRU) order.
 */
export function orderKeysDeskFirst(
  keys: readonly string[],
  deskKeys: ReadonlySet<string>,
  headCount: number,
): readonly string[] {
  if (deskKeys.size === 0) {
    return keys;
  }
  const head = keys.slice(0, headCount);
  const rest = keys.slice(headCount);
  return [
    ...head,
    ...rest.filter((key) => deskKeys.has(key)),
    ...rest.filter((key) => !deskKeys.has(key)),
  ];
}

export function toKeySet(keys: readonly string[]): ReadonlySet<string> {
  return keys.length === 0 ? EMPTY_KEYS : new Set(keys);
}

import { create } from "zustand";
import type { HomeSnapshot } from "@getpaseo/protocol/home";

/**
 * The daemons' Home snapshots (brief, state, closed-today), one per host. Not persisted: the
 * daemon owns the truth. Fed by one `get` on connect, then the `home_update` pushes (and the reply
 * to each action, which is the same full snapshot).
 *
 * Two orderings are guarded, like the folders store:
 * - a `get` that lands after a push began its life earlier and is dropped (`beginGet`/`applyGet`);
 * - a snapshot older than the one held (`updatedAt`) never replaces it.
 */
interface HomeDataState {
  snapshots: Record<string, HomeSnapshot>;
  /** Pushes received per host; a get is stale when this moved since it started. */
  pushCounts: Record<string, number>;
  /** A push, or the reply to an action: the full snapshot, applied unless it is older. */
  applyPush: (serverId: string, snapshot: HomeSnapshot) => void;
  /** Starts a get; hand the ticket back to `applyGet` with the reply. */
  beginGet: (serverId: string) => number;
  /** Applies the reply of a get unless a push overtook it. Returns whether it was applied. */
  applyGet: (serverId: string, ticket: number, snapshot: HomeSnapshot) => boolean;
  clearHost: (serverId: string) => void;
}

function timeOf(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isOlder(candidate: HomeSnapshot, held: HomeSnapshot | undefined): boolean {
  return held !== undefined && timeOf(candidate.updatedAt) < timeOf(held.updatedAt);
}

export const useHomeDataStore = create<HomeDataState>()((set, get) => ({
  snapshots: {},
  pushCounts: {},
  applyPush: (serverId, snapshot) =>
    set((state) => ({
      pushCounts: { ...state.pushCounts, [serverId]: (state.pushCounts[serverId] ?? 0) + 1 },
      snapshots: isOlder(snapshot, state.snapshots[serverId])
        ? state.snapshots
        : { ...state.snapshots, [serverId]: snapshot },
    })),
  beginGet: (serverId) => get().pushCounts[serverId] ?? 0,
  applyGet: (serverId, ticket, snapshot) => {
    const state = get();
    if ((state.pushCounts[serverId] ?? 0) !== ticket) return false;
    if (isOlder(snapshot, state.snapshots[serverId])) return false;
    set({ snapshots: { ...state.snapshots, [serverId]: snapshot } });
    return true;
  },
  clearHost: (serverId) =>
    set((state) => {
      const snapshots = { ...state.snapshots };
      delete snapshots[serverId];
      return { snapshots };
    }),
}));

import { useEffect, useMemo } from "react";
import type {
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useHosts } from "@/runtime/host-runtime";
import { useHydratedWorkspaceServerIds } from "@/stores/session-store-hooks";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { reconcileDesk, type DeskWorkspaceFact } from "@/desk/model";
import { useDeskStore, useDeskStoreHydrated } from "@/desk/desk-store";

/**
 * Keeps the Desk's bookkeeping in step with the live workspace list: seeds it on first run, puts
 * workspaces that appear afterwards on the Desk, and forgets archived ones.
 *
 * Only hosts whose live workspace list has finished loading take part, so a host that connects
 * late is baselined (its workspaces are not "new") and an unloaded host is never pruned.
 */
export function useDeskReconcile(input: {
  enabled: boolean;
  placements: readonly SidebarWorkspacePlacement[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): void {
  const { enabled, placements, workspaceEntriesByKey } = input;
  const hydrated = useDeskStoreHydrated();
  const seeded = useDeskStore((state) => state.seeded);
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  // Same scope as the sidebar's own list: a host the sidebar is filtered away from has no
  // placements here, so counting it as "loaded and empty" would flood the Desk when the filter lifts.
  const serverIds = useMemo(() => {
    const all = hosts.map((host) => host.serverId);
    const matched = all.filter((serverId) => hostFilters.includes(serverId));
    return hostFilters.length > 0 && matched.length > 0 ? matched : all;
  }, [hostFilters, hosts]);
  const loadedServerIds = useHydratedWorkspaceServerIds(serverIds);
  // Statuses only matter for the one-time seed; afterwards entry churn must not re-run this.
  const seedEntries = seeded ? null : workspaceEntriesByKey;

  useEffect(() => {
    if (!enabled || !hydrated) {
      return;
    }
    const loaded = new Set(loadedServerIds);
    const livePlacements = placements.filter((placement) => loaded.has(placement.serverId));
    if (
      seedEntries &&
      livePlacements.some((placement) => !seedEntries.has(placement.workspaceKey))
    ) {
      return;
    }
    const workspaces: DeskWorkspaceFact[] = livePlacements.map((placement) => {
      const entry = seedEntries?.get(placement.workspaceKey);
      return {
        workspaceKey: placement.workspaceKey,
        serverId: placement.serverId,
        pinned: Boolean(entry?.pinnedAt),
        statusBucket: entry?.statusBucket ?? null,
        statusEnteredAt: entry?.statusEnteredAt ?? null,
      };
    });
    const store = useDeskStore.getState();
    const current = {
      deskKeys: store.deskKeys,
      seenKeys: store.seenKeys,
      seenHosts: store.seenHosts,
      seeded: store.seeded,
    };
    const next = reconcileDesk({
      state: current,
      workspaces,
      loadedServerIds: loaded,
      now: Date.now(),
    });
    if (next !== current) {
      store.applySync(next);
    }
  }, [enabled, hydrated, loadedServerIds, placements, seedEntries]);
}

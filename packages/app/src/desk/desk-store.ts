import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { DEFAULT_DESK_GROUPING, type DeskGrouping, type DeskSyncState } from "@/desk/model";

const DESK_STORE_VERSION = 1;

interface DeskPersistedState {
  deskKeys: string[];
  seenKeys: string[];
  seenHosts: string[];
  seeded: boolean;
  shelfCollapsed: boolean;
  deskGrouping: DeskGrouping;
}

interface DeskStoreState extends DeskPersistedState {
  putOnDesk: (workspaceKey: string) => void;
  takeOffDesk: (workspaceKey: string) => void;
  /** Adds the workspace when it is off the Desk, removes it when on. Returns the new state. */
  toggleDesk: (workspaceKey: string) => boolean;
  /** Undo for "Clear desk": puts keys back without reordering the ones already there. */
  restoreDeskKeys: (workspaceKeys: readonly string[]) => void;
  removeDeskKeys: (workspaceKeys: readonly string[]) => void;
  applySync: (next: DeskSyncState) => void;
  toggleShelfCollapsed: () => void;
  setDeskGrouping: (grouping: DeskGrouping) => void;
}

const DeskGroupingSchema = z.enum(["recent", "project", "status"]);
const DeskPersistedStateSchema = z.strictObject({
  deskKeys: z.array(z.string()).optional(),
  seenKeys: z.array(z.string()).optional(),
  seenHosts: z.array(z.string()).optional(),
  seeded: z.boolean().optional(),
  shelfCollapsed: z.boolean().optional(),
  deskGrouping: DeskGroupingSchema.optional(),
});

function emptyDeskState(): DeskPersistedState {
  return {
    deskKeys: [],
    seenKeys: [],
    seenHosts: [],
    seeded: false,
    // The Shelf is the long tail; it starts folded so the Desk is what you see first.
    shelfCollapsed: true,
    deskGrouping: DEFAULT_DESK_GROUPING,
  };
}

/** Junk or an older shape never crashes the sidebar: it just starts from an empty Desk. */
export function migrateDeskState(persistedState: unknown): DeskPersistedState {
  const result = DeskPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return emptyDeskState();
  }
  const empty = emptyDeskState();
  return {
    deskKeys: result.data.deskKeys ?? empty.deskKeys,
    seenKeys: result.data.seenKeys ?? empty.seenKeys,
    seenHosts: result.data.seenHosts ?? empty.seenHosts,
    seeded: result.data.seeded ?? empty.seeded,
    shelfCollapsed: result.data.shelfCollapsed ?? empty.shelfCollapsed,
    deskGrouping: result.data.deskGrouping ?? empty.deskGrouping,
  };
}

export const useDeskStore = create<DeskStoreState>()(
  persist(
    (set, get) => ({
      ...emptyDeskState(),
      putOnDesk: (workspaceKey) => {
        if (!get().deskKeys.includes(workspaceKey)) {
          set((state) => ({ deskKeys: [...state.deskKeys, workspaceKey] }));
        }
      },
      takeOffDesk: (workspaceKey) => {
        if (get().deskKeys.includes(workspaceKey)) {
          set((state) => ({ deskKeys: state.deskKeys.filter((key) => key !== workspaceKey) }));
        }
      },
      toggleDesk: (workspaceKey) => {
        const onDesk = get().deskKeys.includes(workspaceKey);
        if (onDesk) {
          get().takeOffDesk(workspaceKey);
        } else {
          get().putOnDesk(workspaceKey);
        }
        return !onDesk;
      },
      restoreDeskKeys: (workspaceKeys) => {
        const present = new Set(get().deskKeys);
        const missing = workspaceKeys.filter((key) => !present.has(key));
        if (missing.length > 0) {
          set((state) => ({ deskKeys: [...state.deskKeys, ...missing] }));
        }
      },
      removeDeskKeys: (workspaceKeys) => {
        const removed = new Set(workspaceKeys);
        if (get().deskKeys.some((key) => removed.has(key))) {
          set((state) => ({ deskKeys: state.deskKeys.filter((key) => !removed.has(key)) }));
        }
      },
      applySync: (next) => {
        set({
          deskKeys: [...next.deskKeys],
          seenKeys: [...next.seenKeys],
          seenHosts: [...next.seenHosts],
          seeded: next.seeded,
        });
      },
      toggleShelfCollapsed: () => set((state) => ({ shelfCollapsed: !state.shelfCollapsed })),
      setDeskGrouping: (grouping) => set({ deskGrouping: grouping }),
    }),
    {
      name: "paseo-desk",
      storage: createValidatedPersistStorage(AsyncStorage, DeskPersistedStateSchema),
      version: DESK_STORE_VERSION,
      migrate: migrateDeskState,
      partialize: (state): DeskPersistedState => ({
        deskKeys: state.deskKeys,
        seenKeys: state.seenKeys,
        seenHosts: state.seenHosts,
        seeded: state.seeded,
        shelfCollapsed: state.shelfCollapsed,
        deskGrouping: state.deskGrouping,
      }),
    },
  ),
);

/** The reconcile hook must not write before the persisted Desk has loaded, or it would clobber it. */
export function useDeskStoreHydrated(): boolean {
  const [hasHydrated, setHasHydrated] = useState(() => useDeskStore.persist.hasHydrated());

  useEffect(() => {
    if (useDeskStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }
    return useDeskStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
  }, []);

  return hasHydrated;
}

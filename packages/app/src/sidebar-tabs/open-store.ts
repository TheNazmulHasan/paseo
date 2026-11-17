import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const OPEN_STORE_VERSION = 1;

interface SidebarTabsPersistedState {
  /** Keys of the rows whose session list is unfolded: `serverId:workspaceId`, or `board:<id>`. */
  openKeys: string[];
}

interface SidebarTabsStoreState extends SidebarTabsPersistedState {
  toggle: (key: string) => void;
}

const SidebarTabsPersistedStateSchema = z.strictObject({
  openKeys: z.array(z.string()).optional(),
});

/** Junk or an older shape never crashes the sidebar: every list starts folded. */
export function migrateSidebarTabsState(persistedState: unknown): SidebarTabsPersistedState {
  const result = SidebarTabsPersistedStateSchema.safeParse(persistedState);
  return { openKeys: result.success ? (result.data.openKeys ?? []) : [] };
}

/** Which rows show their sessions. Remembered per workspace and view on this device. */
export const useSidebarTabsStore = create<SidebarTabsStoreState>()(
  persist(
    (set) => ({
      openKeys: [],
      toggle: (key) =>
        set((state) => ({
          openKeys: state.openKeys.includes(key)
            ? state.openKeys.filter((openKey) => openKey !== key)
            : [...state.openKeys, key],
        })),
    }),
    {
      name: "paseo-sidebar-tabs",
      storage: createValidatedPersistStorage(AsyncStorage, SidebarTabsPersistedStateSchema),
      version: OPEN_STORE_VERSION,
      migrate: migrateSidebarTabsState,
      partialize: (state): SidebarTabsPersistedState => ({ openKeys: state.openKeys }),
    },
  ),
);

export function useIsSidebarTabsOpen(key: string): boolean {
  return useSidebarTabsStore((state) => state.openKeys.includes(key));
}

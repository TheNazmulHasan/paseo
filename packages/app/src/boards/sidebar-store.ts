import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const SIDEBAR_STORE_VERSION = 1;

interface ViewsSidebarPersistedState {
  collapsed: boolean;
}

interface ViewsSidebarStoreState extends ViewsSidebarPersistedState {
  toggleCollapsed: () => void;
}

const ViewsSidebarPersistedStateSchema = z.strictObject({
  collapsed: z.boolean().optional(),
});

/** Junk or an older shape never crashes the sidebar: the section just starts open. */
export function migrateViewsSidebarState(persistedState: unknown): ViewsSidebarPersistedState {
  const result = ViewsSidebarPersistedStateSchema.safeParse(persistedState);
  return { collapsed: result.success ? (result.data.collapsed ?? false) : false };
}

/** Whether the sidebar's Views section (Live + saved splits) is folded. Persisted. */
export const useViewsSidebarStore = create<ViewsSidebarStoreState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: "paseo-views-sidebar",
      storage: createValidatedPersistStorage(AsyncStorage, ViewsSidebarPersistedStateSchema),
      version: SIDEBAR_STORE_VERSION,
      migrate: migrateViewsSidebarState,
      partialize: (state): ViewsSidebarPersistedState => ({ collapsed: state.collapsed }),
    },
  ),
);

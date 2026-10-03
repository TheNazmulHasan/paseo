/**
 * One remembered open/closed state for the right Files explorer across every workspace and view,
 * so Hyper+J switching keeps the sidebars as the user left them. (The left sidebar is already one
 * global flag: panel-store `desktop.agentListOpen`.)
 *
 * `null` = the user has not chosen yet; workspaces keep whatever their own layout says.
 */
import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const GLOBAL_SIDEBARS_STORE_VERSION = 1;

interface GlobalSidebarsPersistedState {
  explorerOpen: boolean | null;
}

interface GlobalSidebarsStoreState extends GlobalSidebarsPersistedState {
  setExplorerOpen: (open: boolean) => void;
}

const GlobalSidebarsPersistedStateSchema = z.strictObject({
  explorerOpen: z.boolean().nullable().optional(),
});

/** Junk or an older shape never crashes the app: the explorer just has no remembered choice. */
export function migrateGlobalSidebarsState(persistedState: unknown): GlobalSidebarsPersistedState {
  const result = GlobalSidebarsPersistedStateSchema.safeParse(persistedState);
  return { explorerOpen: result.success ? (result.data.explorerOpen ?? null) : null };
}

export const useGlobalSidebarsStore = create<GlobalSidebarsStoreState>()(
  persist(
    (set) => ({
      explorerOpen: null,
      setExplorerOpen: (open) =>
        set((state) => (state.explorerOpen === open ? state : { explorerOpen: open })),
    }),
    {
      name: "paseo-global-sidebars",
      storage: createValidatedPersistStorage(AsyncStorage, GlobalSidebarsPersistedStateSchema),
      version: GLOBAL_SIDEBARS_STORE_VERSION,
      migrate: migrateGlobalSidebarsState,
      partialize: (state): GlobalSidebarsPersistedState => ({ explorerOpen: state.explorerOpen }),
    },
  ),
);

/** Non-hook write, for the explorer toggle helpers that run outside React. */
export function setGlobalExplorerOpen(open: boolean): void {
  useGlobalSidebarsStore.getState().setExplorerOpen(open);
}

export function getGlobalExplorerOpen(): boolean | null {
  return useGlobalSidebarsStore.getState().explorerOpen;
}

export function useGlobalExplorerOpen(): [boolean, (open: boolean) => void] {
  const open = useGlobalSidebarsStore((state) => state.explorerOpen ?? false);
  const set = useCallback((next: boolean) => setGlobalExplorerOpen(next), []);
  return [open, set];
}

/**
 * What a workspace's explorer must do to match the remembered state when the workspace becomes
 * the active route. `null` = leave it alone (no remembered choice, or already matching).
 */
export function resolveExplorerSync(input: {
  globalOpen: boolean | null;
  layoutOpen: boolean;
}): "show" | "hide" | null {
  if (input.globalOpen === null || input.globalOpen === input.layoutOpen) {
    return null;
  }
  return input.globalOpen ? "show" : "hide";
}

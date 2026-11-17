import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  INITIAL_HOME_FOLD_STATE,
  setAllFolds,
  toggleNodeFold,
  type HomeFoldLevel,
  type HomeFoldState,
} from "@/home-map/model";

const HOME_STORE_VERSION = 1;

interface HomePersistedState {
  baseline: HomeFoldState["baseline"];
  overrides: Record<string, boolean>;
  /** "Show quiet": parked sessions and parked-only workspaces on the map. Off by default. */
  showQuiet: boolean;
}

interface HomeStoreState extends HomePersistedState {
  toggleNode: (key: string, level: HomeFoldLevel) => void;
  /** Unfold all (`true`) or Fold all (`false`). */
  setAll: (open: boolean) => void;
  setShowQuiet: (showQuiet: boolean) => void;
}

const HomePersistedStateSchema = z.strictObject({
  baseline: z.enum(["default", "open", "folded"]).optional(),
  overrides: z.record(z.string(), z.boolean()).optional(),
  showQuiet: z.boolean().optional(),
});

function emptyHomeState(): HomePersistedState {
  return {
    baseline: INITIAL_HOME_FOLD_STATE.baseline,
    overrides: { ...INITIAL_HOME_FOLD_STATE.overrides },
    showQuiet: false,
  };
}

/** Junk or an older shape never crashes Home: it starts from the defaults. */
export function migrateHomeState(persistedState: unknown): HomePersistedState {
  const result = HomePersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return emptyHomeState();
  }
  const empty = emptyHomeState();
  return {
    baseline: result.data.baseline ?? empty.baseline,
    overrides: result.data.overrides ?? empty.overrides,
    showQuiet: result.data.showQuiet ?? empty.showQuiet,
  };
}

/** The Home map's fold state and its Show quiet switch, remembered on this device. */
export const useHomeStore = create<HomeStoreState>()(
  persist(
    (set) => ({
      ...emptyHomeState(),
      toggleNode: (key, level) =>
        set((state) => {
          const next = toggleNodeFold(
            { baseline: state.baseline, overrides: state.overrides },
            key,
            level,
          );
          return { baseline: next.baseline, overrides: next.overrides };
        }),
      setAll: (open) => {
        const next = setAllFolds(open);
        set({ baseline: next.baseline, overrides: next.overrides });
      },
      setShowQuiet: (showQuiet) => set({ showQuiet }),
    }),
    {
      name: "paseo-home-map",
      storage: createValidatedPersistStorage(AsyncStorage, HomePersistedStateSchema),
      version: HOME_STORE_VERSION,
      migrate: migrateHomeState,
      partialize: (state): HomePersistedState => ({
        baseline: state.baseline,
        overrides: state.overrides,
        showQuiet: state.showQuiet,
      }),
    },
  ),
);

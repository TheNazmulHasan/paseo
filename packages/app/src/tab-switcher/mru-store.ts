import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  recordVisit,
  TAB_SWITCHER_HISTORY_LIMIT,
  type TabSwitcherVisit,
} from "@/tab-switcher/model";

interface TabSwitcherMruStoreState {
  history: readonly TabSwitcherVisit[];
  visit: (input: { serverId: string; agentId: string }) => void;
  setHistory: (history: readonly TabSwitcherVisit[]) => void;
}

const TabSwitcherVisitSchema = z.strictObject({
  serverId: z.string(),
  agentId: z.string(),
  at: z.number(),
});

const TabSwitcherPersistedStateSchema = z.strictObject({
  history: z.array(TabSwitcherVisitSchema).optional(),
});

export const useTabSwitcherMruStore = create<TabSwitcherMruStoreState>()(
  persist(
    (set, get) => ({
      history: [],
      visit: ({ serverId, agentId }) => {
        const next = recordVisit(
          get().history,
          { serverId, agentId, at: Date.now() },
          TAB_SWITCHER_HISTORY_LIMIT,
        );
        if (next !== get().history) {
          set({ history: next });
        }
      },
      setHistory: (history) => {
        set({ history });
      },
    }),
    {
      name: "tab-switcher-mru",
      storage: createValidatedPersistStorage(AsyncStorage, TabSwitcherPersistedStateSchema),
      partialize: (state) => ({ history: [...state.history] }),
      version: 1,
    },
  ),
);

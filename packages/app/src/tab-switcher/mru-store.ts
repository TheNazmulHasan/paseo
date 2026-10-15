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
  visit: (input: Omit<TabSwitcherVisit, "at">) => void;
  setHistory: (history: readonly TabSwitcherVisit[]) => void;
}

const TabSwitcherAgentVisitSchema = z.strictObject({
  kind: z.literal("agent"),
  serverId: z.string(),
  agentId: z.string(),
  at: z.number(),
});

const TabSwitcherFileVisitSchema = z.strictObject({
  kind: z.literal("file"),
  serverId: z.string(),
  workspaceId: z.string(),
  path: z.string(),
  at: z.number(),
});

/** v1 entries predate file tabs and carry no `kind`. Migrated below, not dropped. */
const TabSwitcherLegacyAgentVisitSchema = z.strictObject({
  serverId: z.string(),
  agentId: z.string(),
  at: z.number(),
});

const TabSwitcherVisitSchema = z.union([
  TabSwitcherAgentVisitSchema,
  TabSwitcherFileVisitSchema,
  TabSwitcherLegacyAgentVisitSchema,
]);

const TabSwitcherPersistedStateSchema = z.strictObject({
  history: z.array(TabSwitcherVisitSchema).optional(),
});

/**
 * v1 -> v2: file tabs joined the switcher, so a visit became a tagged union.
 * Every stored entry was an agent visit, so tag it and keep the history rather
 * than making him rebuild his recent list.
 */
export function migrateTabSwitcherState(persisted: unknown): { history: TabSwitcherVisit[] } {
  const parsed = TabSwitcherPersistedStateSchema.safeParse(persisted);
  if (!parsed.success) {
    return { history: [] };
  }
  const history: TabSwitcherVisit[] = [];
  for (const entry of parsed.data.history ?? []) {
    if ("kind" in entry) {
      history.push(entry);
      continue;
    }
    history.push({
      kind: "agent",
      serverId: entry.serverId,
      agentId: entry.agentId,
      at: entry.at,
    });
  }
  return { history };
}

export const useTabSwitcherMruStore = create<TabSwitcherMruStoreState>()(
  persist(
    (set, get) => ({
      history: [],
      visit: (input) => {
        const next = recordVisit(
          get().history,
          { ...input, at: Date.now() } as TabSwitcherVisit,
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
      version: 2,
      migrate: migrateTabSwitcherState,
    },
  ),
);

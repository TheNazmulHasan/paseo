import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  pruneWorkspaceHistory,
  recordWorkspaceVisit,
  WORKSPACE_SWITCHER_HISTORY_LIMIT,
  type WorkspaceSwitcherVisit,
} from "@/workspace-switcher/model";

interface WorkspaceSwitcherMruStoreState {
  history: readonly WorkspaceSwitcherVisit[];
  visit: (input: Omit<WorkspaceSwitcherVisit, "at">) => void;
  /** Drop visits to workspaces that no longer exist, so archived ones stop filling the history. */
  prune: (liveKeys: ReadonlySet<string>, keepKey: string | null) => void;
}

const WorkspaceSwitcherPersistedStateSchema = z.strictObject({
  history: z
    .array(
      z.strictObject({
        serverId: z.string(),
        workspaceId: z.string(),
        at: z.number(),
      }),
    )
    .optional(),
});

export function migrateWorkspaceSwitcherState(persisted: unknown): {
  history: WorkspaceSwitcherVisit[];
} {
  const parsed = WorkspaceSwitcherPersistedStateSchema.safeParse(persisted);
  if (!parsed.success) {
    return { history: [] };
  }
  return { history: (parsed.data.history ?? []).slice(0, WORKSPACE_SWITCHER_HISTORY_LIMIT) };
}

export const useWorkspaceSwitcherMruStore = create<WorkspaceSwitcherMruStoreState>()(
  persist(
    (set, get) => ({
      history: [],
      visit: (input) => {
        const next = recordWorkspaceVisit(get().history, { ...input, at: Date.now() });
        if (next !== get().history) {
          set({ history: next });
        }
      },
      prune: (liveKeys, keepKey) => {
        const next = pruneWorkspaceHistory(get().history, liveKeys, keepKey);
        if (next !== get().history) {
          set({ history: next });
        }
      },
    }),
    {
      name: "paseo-workspace-switcher-mru",
      storage: createValidatedPersistStorage(AsyncStorage, WorkspaceSwitcherPersistedStateSchema),
      version: 1,
      migrate: migrateWorkspaceSwitcherState,
      partialize: (state) => ({ history: [...state.history] }),
    },
  ),
);

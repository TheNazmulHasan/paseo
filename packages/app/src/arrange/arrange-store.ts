import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { ArrangePreset } from "@/arrange/types";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  stripEphemeralTabsFromLayout,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { WorkspaceLayoutPersistedStateSchema } from "@/stores/workspace-layout-storage";

/** "watch" is not a preset (it is grid over working agents) but pressing it twice restores too. */
export type ArrangeLastPreset = ArrangePreset | "watch";

export type SplitSizeOverrides = Record<string, number[]>;

export interface ArrangeSnapshot {
  layout: WorkspaceLayout;
  splitSizes: SplitSizeOverrides;
}

export interface NamedLayout {
  id: string;
  name: string;
  savedAt: number;
  layout: WorkspaceLayout;
  splitSizes: SplitSizeOverrides;
}

export interface ArrangeWorkspaceState {
  /** The layout from before the first arrange of a run; what "Restore" puts back. */
  snapshot: ArrangeSnapshot | null;
  lastPreset: ArrangeLastPreset | null;
  watchActive: boolean;
  watchedAgentIds: string[];
  namedLayouts: NamedLayout[];
}

export const EMPTY_ARRANGE_WORKSPACE_STATE: ArrangeWorkspaceState = Object.freeze({
  snapshot: null,
  lastPreset: null,
  watchActive: false,
  watchedAgentIds: [],
  namedLayouts: [],
});

interface ArrangeStoreState {
  /** Per workspace key (buildWorkspaceTabPersistenceKey). */
  byWorkspace: Record<string, ArrangeWorkspaceState>;
  patchWorkspace: (workspaceKey: string, patch: Partial<ArrangeWorkspaceState>) => void;
  upsertNamedLayout: (workspaceKey: string, layout: NamedLayout) => void;
  removeNamedLayout: (workspaceKey: string, layoutId: string) => void;
}

// The layout schema is the layout store's own, so a snapshot is valid exactly when
// the layout it was copied from was.
const LayoutSchema = WorkspaceLayoutPersistedStateSchema.shape.layoutByWorkspace.valueType;
const SplitSizesSchema = z.record(z.string(), z.array(z.number()));

const NamedLayoutSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  savedAt: z.number(),
  layout: LayoutSchema,
  splitSizes: SplitSizesSchema,
});

const ArrangeWorkspaceSchema = z.strictObject({
  snapshot: z.strictObject({ layout: LayoutSchema, splitSizes: SplitSizesSchema }).nullable(),
  lastPreset: z.enum(["single", "columns-2", "columns-3", "grid", "watch"]).nullable(),
  watchActive: z.boolean(),
  watchedAgentIds: z.array(z.string()),
  namedLayouts: z.array(NamedLayoutSchema),
});

const ArrangePersistedStateSchema = z.strictObject({
  byWorkspace: z.record(z.string(), ArrangeWorkspaceSchema),
});

type ArrangePersistedState = z.infer<typeof ArrangePersistedStateSchema>;

/**
 * Anything that is not a well-formed state becomes an empty one: a layout helper
 * must never be the reason the app fails to start. Entries are checked one by one,
 * so a single bad workspace does not cost the others their saved layouts.
 */
export function parseArrangePersistedState(persisted: unknown): ArrangePersistedState {
  const outer = z.object({ byWorkspace: z.record(z.string(), z.unknown()) }).safeParse(persisted);
  if (!outer.success) {
    return { byWorkspace: {} };
  }
  const byWorkspace: ArrangePersistedState["byWorkspace"] = {};
  for (const [workspaceKey, entry] of Object.entries(outer.data.byWorkspace)) {
    const parsed = ArrangeWorkspaceSchema.safeParse(entry);
    if (parsed.success) {
      byWorkspace[workspaceKey] = parsed.data;
    }
  }
  return { byWorkspace };
}

function isEmptyWorkspaceState(state: ArrangeWorkspaceState): boolean {
  return (
    state.snapshot === null &&
    state.lastPreset === null &&
    !state.watchActive &&
    state.watchedAgentIds.length === 0 &&
    state.namedLayouts.length === 0
  );
}

function withWorkspace(
  byWorkspace: Record<string, ArrangeWorkspaceState>,
  workspaceKey: string,
  next: ArrangeWorkspaceState,
): Record<string, ArrangeWorkspaceState> {
  if (isEmptyWorkspaceState(next)) {
    const { [workspaceKey]: _removed, ...rest } = byWorkspace;
    return rest;
  }
  return { ...byWorkspace, [workspaceKey]: next };
}

function stripSnapshot(snapshot: ArrangeSnapshot | null): ArrangeSnapshot | null {
  return snapshot ? { ...snapshot, layout: stripEphemeralTabsFromLayout(snapshot.layout) } : null;
}

function stripNamedLayout(named: NamedLayout): NamedLayout {
  return { ...named, layout: stripEphemeralTabsFromLayout(named.layout) };
}

export const useArrangeStore = create<ArrangeStoreState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      patchWorkspace: (workspaceKey, patch) => {
        const current = get().byWorkspace[workspaceKey] ?? EMPTY_ARRANGE_WORKSPACE_STATE;
        set({
          byWorkspace: withWorkspace(get().byWorkspace, workspaceKey, { ...current, ...patch }),
        });
      },
      upsertNamedLayout: (workspaceKey, layout) => {
        const current = get().byWorkspace[workspaceKey] ?? EMPTY_ARRANGE_WORKSPACE_STATE;
        const exists = current.namedLayouts.some((entry) => entry.id === layout.id);
        const namedLayouts = exists
          ? current.namedLayouts.map((entry) => (entry.id === layout.id ? layout : entry))
          : [...current.namedLayouts, layout];
        set({
          byWorkspace: withWorkspace(get().byWorkspace, workspaceKey, { ...current, namedLayouts }),
        });
      },
      removeNamedLayout: (workspaceKey, layoutId) => {
        const current = get().byWorkspace[workspaceKey];
        if (!current?.namedLayouts.some((entry) => entry.id === layoutId)) {
          return;
        }
        set({
          byWorkspace: withWorkspace(get().byWorkspace, workspaceKey, {
            ...current,
            namedLayouts: current.namedLayouts.filter((entry) => entry.id !== layoutId),
          }),
        });
      },
    }),
    {
      name: "paseo-arrange",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, ArrangePersistedStateSchema),
      migrate: (persisted) => parseArrangePersistedState(persisted),
      partialize: (state) => {
        // Same rule as the layout store: commit-diff and new-tab tabs never reach disk.
        const byWorkspace: Record<string, ArrangeWorkspaceState> = {};
        for (const [workspaceKey, entry] of Object.entries(state.byWorkspace)) {
          byWorkspace[workspaceKey] = {
            ...entry,
            snapshot: stripSnapshot(entry.snapshot),
            namedLayouts: entry.namedLayouts.map(stripNamedLayout),
          };
        }
        return { byWorkspace };
      },
      merge: (persisted, current) =>
        persisted && typeof persisted === "object"
          ? { ...current, byWorkspace: parseArrangePersistedState(persisted).byWorkspace }
          : current,
    },
  ),
);

export function getArrangeWorkspaceState(workspaceKey: string): ArrangeWorkspaceState {
  return useArrangeStore.getState().byWorkspace[workspaceKey] ?? EMPTY_ARRANGE_WORKSPACE_STATE;
}

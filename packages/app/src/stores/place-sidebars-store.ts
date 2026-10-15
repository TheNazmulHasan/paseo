/**
 * Each "place" (a workspace, or a view) remembers its own sidebar state, so Hyper+J between
 * places brings back the sidebars exactly as the user left each one.
 *
 * Place key: a workspace is `serverId:workspaceId` (buildWorkspaceTabPersistenceKey), a view is
 * `board:<boardId>`. Only the left sidebar is recorded here: the right explorer is already
 * per place (a workspace's layout, a view's `board.explorerOpen`).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";

const PLACE_SIDEBARS_STORE_VERSION = 1;
export const MAX_REMEMBERED_PLACES = 300;

export interface PlaceSidebars {
  left?: boolean;
  right?: boolean;
}

interface PlaceSidebarsPersistedState {
  byPlace: Record<string, PlaceSidebars>;
}

interface PlaceSidebarsStoreState extends PlaceSidebarsPersistedState {
  rememberPlaceSidebars: (placeKey: string, patch: PlaceSidebars) => void;
}

const PlaceSidebarsSchema = z.strictObject({
  left: z.boolean().optional(),
  right: z.boolean().optional(),
});

const PlaceSidebarsPersistedStateSchema = z.strictObject({
  byPlace: z.record(z.string(), PlaceSidebarsSchema),
});

/** Junk or an older shape never crashes the app: every place simply has no remembered state. */
export function migratePlaceSidebarsState(persistedState: unknown): PlaceSidebarsPersistedState {
  const result = PlaceSidebarsPersistedStateSchema.safeParse(persistedState);
  return { byPlace: result.success ? result.data.byPlace : {} };
}

/**
 * Merges `patch` into the place's entry and moves it to the newest slot; once over the cap the
 * oldest places (first inserted) are dropped. Returns the same object when nothing changes.
 */
export function applyPlaceSidebarsPatch(
  byPlace: Record<string, PlaceSidebars>,
  placeKey: string,
  patch: PlaceSidebars,
  max: number = MAX_REMEMBERED_PLACES,
): Record<string, PlaceSidebars> {
  const existing = byPlace[placeKey];
  const merged: PlaceSidebars = { ...existing };
  if (patch.left !== undefined) merged.left = patch.left;
  if (patch.right !== undefined) merged.right = patch.right;
  if (existing && existing.left === merged.left && existing.right === merged.right) {
    return byPlace;
  }
  const next: Record<string, PlaceSidebars> = { ...byPlace };
  delete next[placeKey];
  next[placeKey] = merged;
  const keys = Object.keys(next);
  for (let i = 0; i < keys.length - max; i += 1) {
    delete next[keys[i]];
  }
  return next;
}

export const usePlaceSidebarsStore = create<PlaceSidebarsStoreState>()(
  persist(
    (set) => ({
      byPlace: {},
      rememberPlaceSidebars: (placeKey, patch) =>
        set((state) => {
          const byPlace = applyPlaceSidebarsPatch(state.byPlace, placeKey, patch);
          return byPlace === state.byPlace ? state : { byPlace };
        }),
    }),
    {
      name: "paseo-place-sidebars",
      storage: createValidatedPersistStorage(AsyncStorage, PlaceSidebarsPersistedStateSchema),
      version: PLACE_SIDEBARS_STORE_VERSION,
      migrate: migratePlaceSidebarsState,
      partialize: (state): PlaceSidebarsPersistedState => ({ byPlace: state.byPlace }),
    },
  ),
);

export function rememberPlaceSidebars(placeKey: string, patch: PlaceSidebars): void {
  usePlaceSidebarsStore.getState().rememberPlaceSidebars(placeKey, patch);
}

export function getPlaceSidebars(placeKey: string): PlaceSidebars | undefined {
  return usePlaceSidebarsStore.getState().byPlace[placeKey];
}

/** The place the route shows: a workspace, a view, or null (settings, desk, ...). */
export function resolvePlaceKeyFromPathname(pathname: string): string | null {
  const boardId = parseBoardIdFromPathname(pathname);
  if (boardId) return `board:${boardId}`;
  const workspace = parseHostWorkspaceRouteFromPathname(pathname);
  return workspace ? buildWorkspaceTabPersistenceKey(workspace) : null;
}

export type PlaceLeftSidebarStep =
  | { type: "none" }
  | { type: "apply"; open: boolean }
  | { type: "remember"; open: boolean };

/**
 * What the left sidebar does as the user moves between places.
 * - arriving (place changed): apply the place's stored value; with none stored, keep the sidebar
 *   as it is and store that value for the place.
 * - same place: store the current value whenever it differs from what is stored (a toggle).
 */
export function resolvePlaceLeftSidebarStep(input: {
  placeChanged: boolean;
  stored: boolean | undefined;
  current: boolean;
}): PlaceLeftSidebarStep {
  if (input.placeChanged) {
    if (input.stored === undefined) return { type: "remember", open: input.current };
    return input.stored === input.current
      ? { type: "none" }
      : { type: "apply", open: input.stored };
  }
  return input.stored === input.current
    ? { type: "none" }
    : { type: "remember", open: input.current };
}

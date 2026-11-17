import { useMemo } from "react";
import { create } from "zustand";
import type { FoldersSnapshot } from "@getpaseo/protocol/folders";
import { buildFolderIndex, type ExplicitFolderChoice, type FolderIndex } from "@/folders/model";

/**
 * The daemons' folders, one snapshot per host, fed by the `folders_update` push and one list call
 * per connect. Not persisted: the daemon owns the truth, and a stale copy on disk would show
 * folders that were deleted from another device.
 */
interface FolderStoreState {
  snapshots: Record<string, FoldersSnapshot>;
  /** The inline "new folder" row at the top of the Folders list is open. */
  creating: boolean;
  /** The folder whose + was pressed; the next new workspace goes there. */
  explicitFolder: ExplicitFolderChoice | null;
  /** Replaces the host's snapshot. Every push is the full state, so nothing merges. */
  setSnapshot: (serverId: string, snapshot: FoldersSnapshot) => void;
  setCreating: (creating: boolean) => void;
  setExplicitFolder: (choice: ExplicitFolderChoice | null) => void;
}

export const useFolderStore = create<FolderStoreState>()((set) => ({
  snapshots: {},
  creating: false,
  explicitFolder: null,
  setSnapshot: (serverId, snapshot) =>
    set((state) => ({
      snapshots: {
        ...state.snapshots,
        // Only the two known fields: a push may carry a `subscriptionId` that is not state.
        [serverId]: { folders: snapshot.folders, membership: snapshot.membership },
      },
    })),
  setCreating: (creating) => set({ creating }),
  setExplicitFolder: (explicitFolder) => set({ explicitFolder }),
}));

export function buildIndexFromSnapshots(snapshots: Record<string, FoldersSnapshot>): FolderIndex {
  return buildFolderIndex(
    Object.keys(snapshots)
      .sort()
      .map((serverId) => ({ serverId, snapshot: snapshots[serverId] })),
  );
}

export function getFolderIndex(): FolderIndex {
  return buildIndexFromSnapshots(useFolderStore.getState().snapshots);
}

/** Folders, and where every workspace and view sits, across all connected hosts. */
export function useFolderIndex(): FolderIndex {
  const snapshots = useFolderStore((state) => state.snapshots);
  return useMemo(() => buildIndexFromSnapshots(snapshots), [snapshots]);
}

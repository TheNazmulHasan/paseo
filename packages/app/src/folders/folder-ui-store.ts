import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const FOLDER_UI_STORE_VERSION = 1;

interface FolderUiPersistedState {
  /** The whole Folders section is folded. Starts open: it is now the main way to find things. */
  sectionCollapsed: boolean;
  /** Folder keys (lower-cased names, or the Unfiled key) that are unfolded. Everything starts folded. */
  openKeys: string[];
}

interface FolderUiStoreState extends FolderUiPersistedState {
  toggleSection: () => void;
  toggleFolder: (key: string) => void;
  /** A rename keeps its fold: the key is the name. */
  renameFolderKey: (oldKey: string, newKey: string) => void;
}

const FolderUiPersistedStateSchema = z.strictObject({
  sectionCollapsed: z.boolean().optional(),
  openKeys: z.array(z.string()).optional(),
});

function emptyFolderUiState(): FolderUiPersistedState {
  return { sectionCollapsed: false, openKeys: [] };
}

/** Junk or an older shape never crashes the sidebar: it starts from the defaults. */
export function migrateFolderUiState(persistedState: unknown): FolderUiPersistedState {
  const result = FolderUiPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return emptyFolderUiState();
  }
  const empty = emptyFolderUiState();
  return {
    sectionCollapsed: result.data.sectionCollapsed ?? empty.sectionCollapsed,
    openKeys: result.data.openKeys ?? empty.openKeys,
  };
}

export const useFolderUiStore = create<FolderUiStoreState>()(
  persist(
    (set) => ({
      ...emptyFolderUiState(),
      toggleSection: () => set((state) => ({ sectionCollapsed: !state.sectionCollapsed })),
      toggleFolder: (key) =>
        set((state) => ({
          openKeys: state.openKeys.includes(key)
            ? state.openKeys.filter((openKey) => openKey !== key)
            : [...state.openKeys, key],
        })),
      renameFolderKey: (oldKey, newKey) =>
        set((state) =>
          state.openKeys.includes(oldKey) && oldKey !== newKey
            ? {
                openKeys: [...state.openKeys.filter((key) => key !== oldKey), newKey],
              }
            : state,
        ),
    }),
    {
      name: "paseo-folders",
      storage: createValidatedPersistStorage(AsyncStorage, FolderUiPersistedStateSchema),
      version: FOLDER_UI_STORE_VERSION,
      migrate: migrateFolderUiState,
      partialize: (state): FolderUiPersistedState => ({
        sectionCollapsed: state.sectionCollapsed,
        openKeys: state.openKeys,
      }),
    },
  ),
);

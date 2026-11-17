import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { ArrangePreset } from "@/arrange/types";
import type { Board } from "@/boards/types";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { WorkspaceLayoutPersistedStateSchema } from "@/stores/workspace-layout-storage";

export type BoardSplitSizes = Record<string, number[]>;

export interface BoardArrangeSnapshot {
  layout: WorkspaceLayout;
  splitSizes: BoardSplitSizes;
}

/** Same restore semantics as a workspace's: the layout from before the first arrange of a run. */
export interface BoardArrangeState {
  snapshot: BoardArrangeSnapshot | null;
  lastPreset: ArrangePreset | null;
}

export const EMPTY_BOARD_ARRANGE_STATE: BoardArrangeState = Object.freeze({
  snapshot: null,
  lastPreset: null,
});

interface BoardStoreState {
  boards: Record<string, Board>;
  /** Display order. */
  order: string[];
  arrangeByBoard: Record<string, BoardArrangeState>;
  /** "<leftKey>|<rightKey>" (workspace persistence keys) → the board splitWorkspaces made. */
  splitPairs: Record<string, string>;
  /** Insert or replace; a new id is appended to `order`. */
  putBoard: (board: Board) => void;
  removeBoard: (boardId: string) => boolean;
  patchArrange: (boardId: string, patch: Partial<BoardArrangeState>) => void;
  setSplitPair: (pairKey: string, boardId: string) => void;
  /** Re-keys the board's split-set memory: drops its old key(s), then stores `pairKey` (if any). */
  rekeySplitPair: (boardId: string, pairKey: string | null) => void;
}

const LayoutSchema = WorkspaceLayoutPersistedStateSchema.shape.layoutByWorkspace.valueType;
const SplitSizesSchema = z.record(z.string(), z.array(z.number()));

const BoardSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  // "live" is only ever read: a store saved while the Live view existed still has that board, and
  // a strict read must not throw the user's saved views away with it. It is dropped on load.
  kind: z.enum(["user", "live"]),
  layout: LayoutSchema,
  splitSizes: SplitSizesSchema,
  origins: z.record(
    z.string(),
    z.strictObject({
      serverId: z.string(),
      workspaceId: z.string(),
      agentId: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
  explorerOpen: z.boolean().optional(),
});

const ArrangeStateSchema = z.strictObject({
  snapshot: z.strictObject({ layout: LayoutSchema, splitSizes: SplitSizesSchema }).nullable(),
  lastPreset: z.enum(["single", "columns-2", "columns-3", "grid"]).nullable(),
});

const BoardPersistedStateSchema = z.strictObject({
  boards: z.record(z.string(), BoardSchema),
  order: z.array(z.string()),
  arrangeByBoard: z.record(z.string(), ArrangeStateSchema),
  splitPairs: z.record(z.string(), z.string()),
});

/** What a store holds in memory: stored boards, minus anything that is not a saved view. */
interface BoardPersistedState {
  boards: Record<string, Board>;
  order: string[];
  arrangeByBoard: z.infer<typeof BoardPersistedStateSchema>["arrangeByBoard"];
  splitPairs: Record<string, string>;
}

/** The id the removed Live view lived under; a stored board with it is never loaded. */
const REMOVED_LIVE_VIEW_ID = "live";

/** Every tab must have an origin, or the screen cannot tell which agent it shows. */
function hasOriginsForAllTabs(board: Pick<Board, "layout" | "origins">): boolean {
  const tabIds: string[] = [];
  const visit = (node: Board["layout"]["root"]): void => {
    if (node.kind === "pane") {
      tabIds.push(...node.pane.tabIds);
      return;
    }
    node.group.children.forEach(visit);
  };
  visit(board.layout.root);
  return tabIds.every((tabId) => Boolean(board.origins[tabId]));
}

/**
 * Anything that is not a well-formed state becomes an empty one: a screen helper must never
 * be the reason the app fails to start. Entries are checked one by one, so a single bad
 * board does not cost the others. A stored Live board (id "live" or kind "live", from before the
 * Live view was removed) is dropped, with its order slot, arrange state and split pairs.
 */
export function parseBoardPersistedState(persisted: unknown): BoardPersistedState {
  const outer = z
    .object({
      boards: z.record(z.string(), z.unknown()).catch({}),
      order: z.array(z.unknown()).catch([]),
      arrangeByBoard: z.record(z.string(), z.unknown()).catch({}),
      splitPairs: z.record(z.string(), z.unknown()).catch({}),
    })
    .safeParse(persisted);
  const raw = outer.success
    ? outer.data
    : { boards: {}, order: [], arrangeByBoard: {}, splitPairs: {} };

  const boards: Record<string, Board> = {};
  for (const [id, entry] of Object.entries(raw.boards)) {
    const parsed = BoardSchema.safeParse(entry);
    if (
      parsed.success &&
      parsed.data.id === id &&
      id !== REMOVED_LIVE_VIEW_ID &&
      parsed.data.kind !== "live" &&
      hasOriginsForAllTabs(parsed.data)
    ) {
      boards[id] = { ...parsed.data, kind: "user" };
    }
  }

  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of [...raw.order, ...Object.keys(boards)]) {
    if (typeof id === "string" && boards[id] && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }

  const arrangeByBoard: BoardPersistedState["arrangeByBoard"] = {};
  for (const [id, entry] of Object.entries(raw.arrangeByBoard)) {
    const parsed = ArrangeStateSchema.safeParse(entry);
    if (parsed.success && boards[id]) {
      arrangeByBoard[id] = parsed.data;
    }
  }
  const splitPairs: Record<string, string> = {};
  for (const [pairKey, boardId] of Object.entries(raw.splitPairs)) {
    if (typeof boardId === "string" && boards[boardId]) {
      splitPairs[pairKey] = boardId;
    }
  }
  return { boards, order, arrangeByBoard, splitPairs };
}

function isEmptyArrangeState(state: BoardArrangeState): boolean {
  return state.snapshot === null && state.lastPreset === null;
}

function initialState(): BoardPersistedState {
  return parseBoardPersistedState(null);
}

export const useBoardStore = create<BoardStoreState>()(
  persist(
    (set, get) => ({
      ...initialState(),
      putBoard: (board) => {
        const { boards, order } = get();
        set({
          boards: { ...boards, [board.id]: board },
          order: order.includes(board.id) ? order : [...order, board.id],
        });
      },
      removeBoard: (boardId) => {
        const { boards, order, arrangeByBoard, splitPairs } = get();
        if (!boards[boardId]) {
          return false;
        }
        const { [boardId]: _board, ...restBoards } = boards;
        const { [boardId]: _arrange, ...restArrange } = arrangeByBoard;
        set({
          boards: restBoards,
          order: order.filter((id) => id !== boardId),
          arrangeByBoard: restArrange,
          splitPairs: Object.fromEntries(
            Object.entries(splitPairs).filter(([, id]) => id !== boardId),
          ),
        });
        return true;
      },
      patchArrange: (boardId, patch) => {
        const { arrangeByBoard } = get();
        const next = {
          ...(arrangeByBoard[boardId] ?? EMPTY_BOARD_ARRANGE_STATE),
          ...patch,
        };
        if (isEmptyArrangeState(next)) {
          const { [boardId]: _removed, ...rest } = arrangeByBoard;
          set({ arrangeByBoard: rest });
          return;
        }
        set({ arrangeByBoard: { ...arrangeByBoard, [boardId]: next } });
      },
      setSplitPair: (pairKey, boardId) => {
        set({ splitPairs: { ...get().splitPairs, [pairKey]: boardId } });
      },
      rekeySplitPair: (boardId, pairKey) => {
        const kept = Object.entries(get().splitPairs).filter(([, id]) => id !== boardId);
        set({ splitPairs: Object.fromEntries(pairKey ? [...kept, [pairKey, boardId]] : kept) });
      },
    }),
    {
      name: "paseo-boards",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, BoardPersistedStateSchema),
      migrate: (persisted) => parseBoardPersistedState(persisted),
      partialize: (state) => ({
        boards: state.boards,
        order: state.order,
        arrangeByBoard: state.arrangeByBoard,
        splitPairs: state.splitPairs,
      }),
      merge: (persisted, current) =>
        persisted && typeof persisted === "object"
          ? { ...current, ...parseBoardPersistedState(persisted) }
          : current,
    },
  ),
);

export function getBoardArrangeState(boardId: string): BoardArrangeState {
  return useBoardStore.getState().arrangeByBoard[boardId] ?? EMPTY_BOARD_ARRANGE_STATE;
}

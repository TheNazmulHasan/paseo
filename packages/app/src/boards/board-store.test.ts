import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EMPTY_BOARD_ARRANGE_STATE,
  getBoardArrangeState,
  parseBoardPersistedState,
  useBoardStore,
} from "@/boards/board-store";
import { addSessionsToBoardModel, createEmptyBoardLayout } from "@/boards/model";
import type { Board } from "@/boards/types";

/** The id the removed Live view was stored under. */
const LEGACY_LIVE_ID = "live";

function board(id: string, agentIds: string[] = []): Board {
  const empty: Board = {
    id,
    name: `Board ${id}`,
    createdAt: 5,
    kind: "user",
    layout: createEmptyBoardLayout(),
    splitSizes: { g: [0.4, 0.6] },
    origins: {},
  };
  return addSessionsToBoardModel(
    empty,
    agentIds.map((agentId) => ({ serverId: "s1", workspaceId: "w1", agentId })),
  ).board;
}

function resetStore(): void {
  useBoardStore.setState(parseBoardPersistedState(null));
}

beforeEach(async () => {
  await AsyncStorage.removeItem("paseo-boards");
  resetStore();
});

describe("parseBoardPersistedState", () => {
  it("turns junk into an empty state with no boards", () => {
    for (const junk of [null, undefined, 7, "x", [], {}, { boards: "no" }, { boards: 3 }]) {
      const parsed = parseBoardPersistedState(junk);
      expect(parsed.boards).toEqual({});
      expect(parsed.order).toEqual([]);
      expect(parsed.arrangeByBoard).toEqual({});
      expect(parsed.splitPairs).toEqual({});
    }
  });

  it("keeps well-formed boards and drops only the malformed ones", () => {
    const good = board("good", ["a1"]);
    const parsed = parseBoardPersistedState({
      boards: {
        good,
        wrongId: { ...board("other") },
        badLayout: { ...board("badLayout"), layout: { root: 1 } },
        extraKey: { ...board("extraKey"), surprise: 1 },
        notAnObject: "nope",
        orphanTab: {
          ...board("orphanTab", ["a1"]),
          origins: {},
        },
      },
      order: ["good"],
      arrangeByBoard: {},
      splitPairs: {},
    });
    expect(Object.keys(parsed.boards)).toEqual(["good"]);
    expect(parsed.boards.good?.name).toBe("Board good");
  });

  it("keeps a board that holds a file tab (origin with a path, no agent)", () => {
    const withFile = addSessionsToBoardModel(board("f"), [
      { serverId: "s1", workspaceId: "w1", path: "src/a.ts" },
    ]).board;
    const parsed = parseBoardPersistedState({
      boards: { f: withFile },
      order: ["f"],
      arrangeByBoard: {},
      splitPairs: {},
    });
    expect(Object.values(parsed.boards.f?.origins ?? {})).toEqual([
      { serverId: "s1", workspaceId: "w1", path: "src/a.ts" },
    ]);
  });

  it("keeps the optional explorerOpen flag and still accepts boards without it", () => {
    const parsed = parseBoardPersistedState({
      boards: { on: { ...board("on"), explorerOpen: true }, off: board("off") },
      order: ["on", "off"],
      arrangeByBoard: {},
      splitPairs: {},
    });
    expect(parsed.boards.on?.explorerOpen).toBe(true);
    expect(parsed.boards.off).toBeDefined();
    expect(parsed.boards.off?.explorerOpen).toBeUndefined();
  });

  it("drops a stored Live board, by id or by kind, and keeps the saved views beside it", () => {
    const parsed = parseBoardPersistedState({
      boards: {
        [LEGACY_LIVE_ID]: { ...board(LEGACY_LIVE_ID), kind: "live", name: "Live" },
        sneaky: { ...board("sneaky"), kind: "live" },
        renamed: { ...board(LEGACY_LIVE_ID), kind: "user", name: "Mine" },
        keep: board("keep"),
      },
      order: [LEGACY_LIVE_ID, "sneaky", "keep"],
      arrangeByBoard: { [LEGACY_LIVE_ID]: { snapshot: null, lastPreset: "grid" } },
      splitPairs: { k1: LEGACY_LIVE_ID, k2: "keep" },
    });
    expect(Object.keys(parsed.boards)).toEqual(["keep"]);
    expect(parsed.boards.keep?.kind).toBe("user");
    expect(parsed.order).toEqual(["keep"]);
    expect(parsed.arrangeByBoard).toEqual({});
    expect(parsed.splitPairs).toEqual({ k2: "keep" });
  });

  it("repairs the order: unknown and repeated ids go, unlisted boards follow", () => {
    const parsed = parseBoardPersistedState({
      boards: { a: board("a"), b: board("b") },
      order: ["b", "ghost", "b"],
      arrangeByBoard: {},
      splitPairs: {},
    });
    expect(parsed.order).toEqual(["b", "a"]);
  });

  it("drops arrange state and split pairs that point at nothing", () => {
    const parsed = parseBoardPersistedState({
      boards: { a: board("a") },
      order: ["a"],
      arrangeByBoard: {
        a: { snapshot: null, lastPreset: "grid" },
        ghost: { snapshot: null, lastPreset: "grid" },
        bad: { snapshot: null, lastPreset: "diagonal" },
      },
      splitPairs: { k1: "a", k2: "ghost", k3: LEGACY_LIVE_ID, k4: 5 },
    });
    expect(Object.keys(parsed.arrangeByBoard)).toEqual(["a"]);
    expect(parsed.splitPairs).toEqual({ k1: "a" });
  });
});

describe("useBoardStore", () => {
  it("starts with no boards", () => {
    const state = useBoardStore.getState();
    expect(state.boards).toEqual({});
    expect(state.order).toEqual([]);
  });

  it("puts boards in order and replaces by id", () => {
    const store = useBoardStore.getState();
    store.putBoard(board("a"));
    store.putBoard(board("b"));
    store.putBoard({ ...board("a"), name: "Renamed" });
    expect(useBoardStore.getState().order).toEqual(["a", "b"]);
    expect(useBoardStore.getState().boards.a?.name).toBe("Renamed");
  });

  it("deleting a board forgets its arrange state and split-set entry", () => {
    const store = useBoardStore.getState();
    store.putBoard(board("a"));
    store.putBoard(board("b"));
    store.patchArrange("a", { lastPreset: "grid" });
    store.setSplitPair("set-a", "a");
    store.setSplitPair("set-b", "b");
    expect(useBoardStore.getState().removeBoard("a")).toBe(true);
    expect(useBoardStore.getState().removeBoard("a")).toBe(false);
    const state = useBoardStore.getState();
    expect(state.order).toEqual(["b"]);
    expect(state.arrangeByBoard).toEqual({});
    expect(state.splitPairs).toEqual({ "set-b": "b" });
  });

  it("reads an unknown board's arrange state as the shared empty one", () => {
    expect(getBoardArrangeState("nobody")).toBe(EMPTY_BOARD_ARRANGE_STATE);
  });

  it("patches arrange state and drops the entry once it is back to default", () => {
    const store = useBoardStore.getState();
    store.patchArrange("a", { lastPreset: "single" });
    expect(Object.keys(useBoardStore.getState().arrangeByBoard)).toEqual(["a"]);
    store.patchArrange("a", { lastPreset: null });
    expect(useBoardStore.getState().arrangeByBoard).toEqual({});
  });
});

describe("persistence", () => {
  it("writes under the paseo-boards key and reads it back", async () => {
    const store = useBoardStore.getState();
    store.putBoard(board("a", ["a1", "a2"]));
    store.patchArrange("a", { lastPreset: "grid" });
    store.setSplitPair("set", "a");
    await vi.waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("paseo-boards", expect.any(String));
    });
    const written = await AsyncStorage.getItem("paseo-boards");
    expect(written).toContain('"lastPreset":"grid"');
    resetStore();
    await AsyncStorage.setItem("paseo-boards", written ?? "");
    await useBoardStore.persist.rehydrate();
    const state = useBoardStore.getState();
    expect(state.order).toEqual(["a"]);
    expect(Object.keys(state.boards.a?.origins ?? {})).toHaveLength(2);
    expect(state.arrangeByBoard.a?.lastPreset).toBe("grid");
    expect(state.splitPairs).toEqual({ set: "a" });
  });

  it("starts empty, and does not crash, when the stored blob is corrupt", async () => {
    for (const raw of [
      "{not json",
      JSON.stringify({ state: { boards: "no" }, version: 1 }),
      JSON.stringify({ state: 12, version: 1 }),
    ]) {
      await AsyncStorage.setItem("paseo-boards", raw);
      resetStore();
      await expect(useBoardStore.persist.rehydrate()).resolves.not.toThrow();
      expect(useBoardStore.getState().order).toEqual([]);
    }
  });

  it("loads a store saved while the Live view existed: Live is gone, the saved views stay", async () => {
    await AsyncStorage.setItem(
      "paseo-boards",
      JSON.stringify({
        state: {
          boards: {
            [LEGACY_LIVE_ID]: { ...board(LEGACY_LIVE_ID), kind: "live", name: "Live" },
            a: board("a", ["a1"]),
          },
          order: [LEGACY_LIVE_ID, "a"],
          arrangeByBoard: {},
          splitPairs: {},
        },
        version: 1,
      }),
    );
    await useBoardStore.persist.rehydrate();
    const state = useBoardStore.getState();
    expect(state.order).toEqual(["a"]);
    expect(Object.keys(state.boards)).toEqual(["a"]);
    expect(Object.keys(state.boards.a?.origins ?? {})).toHaveLength(1);
  });

  it("migrates an older stored version through the same lenient parser", async () => {
    await AsyncStorage.setItem(
      "paseo-boards",
      JSON.stringify({
        state: { boards: { a: board("a") }, order: ["a"], arrangeByBoard: {}, splitPairs: {} },
        version: 0,
      }),
    );
    await useBoardStore.persist.rehydrate();
    expect(useBoardStore.getState().boards.a?.name).toBe("Board a");
  });
});

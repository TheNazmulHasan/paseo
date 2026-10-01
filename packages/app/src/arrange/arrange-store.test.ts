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
  EMPTY_ARRANGE_WORKSPACE_STATE,
  getArrangeWorkspaceState,
  parseArrangePersistedState,
  useArrangeStore,
  type NamedLayout,
} from "@/arrange/arrange-store";
import {
  createWorkspaceLayoutWithExplorerSidebar,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

const KEY = "server-1:ws-1";

function layout(): WorkspaceLayout {
  return createWorkspaceLayoutWithExplorerSidebar();
}

function named(id: string, name: string): NamedLayout {
  return { id, name, savedAt: 10, layout: layout(), splitSizes: { g: [0.5, 0.5] } };
}

function validEntry() {
  return {
    snapshot: { layout: layout(), splitSizes: { g: [0.3, 0.7] } },
    lastPreset: "grid",
    watchActive: true,
    watchedAgentIds: ["a1"],
    namedLayouts: [named("n1", "Review")],
  };
}

beforeEach(async () => {
  await AsyncStorage.removeItem("paseo-arrange");
  useArrangeStore.setState({ byWorkspace: {} });
});

describe("parseArrangePersistedState", () => {
  it("turns junk into an empty state instead of throwing", () => {
    for (const junk of [
      null,
      undefined,
      7,
      "x",
      [],
      {},
      { byWorkspace: "no" },
      { byWorkspace: 3 },
    ]) {
      expect(parseArrangePersistedState(junk)).toEqual({ byWorkspace: {} });
    }
  });

  it("keeps well-formed entries and drops only the malformed ones", () => {
    const good = validEntry();
    const parsed = parseArrangePersistedState({
      byWorkspace: {
        good,
        badPreset: { ...validEntry(), lastPreset: "diagonal" },
        missingFields: { watchActive: true },
        extraKey: { ...validEntry(), surprise: 1 },
        notAnObject: "nope",
        badLayout: { ...validEntry(), snapshot: { layout: { root: 1 }, splitSizes: {} } },
      },
    });
    expect(Object.keys(parsed.byWorkspace)).toEqual(["good"]);
    expect(parsed.byWorkspace.good?.namedLayouts[0]?.name).toBe("Review");
    expect(parsed.byWorkspace.good?.lastPreset).toBe("grid");
  });

  it("accepts every preset plus watch and a null preset", () => {
    for (const lastPreset of ["single", "columns-2", "columns-3", "grid", "watch", null]) {
      const parsed = parseArrangePersistedState({
        byWorkspace: { w: { ...validEntry(), lastPreset } },
      });
      expect(parsed.byWorkspace.w?.lastPreset).toBe(lastPreset);
    }
  });
});

describe("useArrangeStore", () => {
  it("reads an unknown workspace as the shared empty state", () => {
    expect(getArrangeWorkspaceState("nobody")).toBe(EMPTY_ARRANGE_WORKSPACE_STATE);
  });

  it("patches one workspace without touching another", () => {
    const store = useArrangeStore.getState();
    store.patchWorkspace(KEY, { lastPreset: "grid", watchedAgentIds: ["a"] });
    store.patchWorkspace("other:ws", { watchActive: true });
    store.patchWorkspace(KEY, { watchActive: true });
    expect(getArrangeWorkspaceState(KEY)).toMatchObject({
      lastPreset: "grid",
      watchActive: true,
      watchedAgentIds: ["a"],
    });
    expect(getArrangeWorkspaceState("other:ws").watchActive).toBe(true);
  });

  it("drops a workspace entry once everything in it is back to default", () => {
    const store = useArrangeStore.getState();
    store.patchWorkspace(KEY, { lastPreset: "single" });
    expect(Object.keys(useArrangeStore.getState().byWorkspace)).toEqual([KEY]);
    store.patchWorkspace(KEY, { lastPreset: null });
    expect(useArrangeStore.getState().byWorkspace).toEqual({});
  });

  it("keeps named layouts when a run is cleared", () => {
    const store = useArrangeStore.getState();
    store.upsertNamedLayout(KEY, named("n1", "Review"));
    store.patchWorkspace(KEY, {
      lastPreset: "grid",
      snapshot: { layout: layout(), splitSizes: {} },
    });
    store.patchWorkspace(KEY, { snapshot: null, lastPreset: null });
    expect(getArrangeWorkspaceState(KEY).namedLayouts.map((entry) => entry.id)).toEqual(["n1"]);
  });

  it("upserts and removes named layouts by id", () => {
    const store = useArrangeStore.getState();
    store.upsertNamedLayout(KEY, named("n1", "One"));
    store.upsertNamedLayout(KEY, named("n2", "Two"));
    store.upsertNamedLayout(KEY, named("n1", "One renamed"));
    expect(getArrangeWorkspaceState(KEY).namedLayouts.map((entry) => entry.name)).toEqual([
      "One renamed",
      "Two",
    ]);
    store.removeNamedLayout(KEY, "n1");
    store.removeNamedLayout(KEY, "missing");
    store.removeNamedLayout("nobody", "n2");
    expect(getArrangeWorkspaceState(KEY).namedLayouts.map((entry) => entry.id)).toEqual(["n2"]);
    store.removeNamedLayout(KEY, "n2");
    expect(useArrangeStore.getState().byWorkspace).toEqual({});
  });
});

describe("persistence", () => {
  it("writes under the paseo-arrange key and reads it back", async () => {
    useArrangeStore.getState().patchWorkspace(KEY, validEntry() as never);
    await vi.waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("paseo-arrange", expect.any(String));
    });
    const written = await AsyncStorage.getItem("paseo-arrange");
    expect(written).toContain('"lastPreset":"grid"');
    // Clearing memory writes an empty blob too, so put the real one back before reading.
    useArrangeStore.setState({ byWorkspace: {} });
    await AsyncStorage.setItem("paseo-arrange", written ?? "");
    await useArrangeStore.persist.rehydrate();
    expect(getArrangeWorkspaceState(KEY).namedLayouts.map((entry) => entry.name)).toEqual([
      "Review",
    ]);
    expect(getArrangeWorkspaceState(KEY).lastPreset).toBe("grid");
  });

  it("starts empty, and does not crash, when the stored blob is corrupt", async () => {
    for (const raw of ["{not json", JSON.stringify({ state: { byWorkspace: "no" }, version: 1 })]) {
      await AsyncStorage.setItem("paseo-arrange", raw);
      useArrangeStore.setState({ byWorkspace: {} });
      await expect(useArrangeStore.persist.rehydrate()).resolves.not.toThrow();
      expect(useArrangeStore.getState().byWorkspace).toEqual({});
    }
  });

  it("migrates an older stored version through the same lenient parser", async () => {
    await AsyncStorage.setItem(
      "paseo-arrange",
      JSON.stringify({ state: { byWorkspace: { [KEY]: validEntry() } }, version: 0 }),
    );
    await useArrangeStore.persist.rehydrate();
    expect(getArrangeWorkspaceState(KEY).watchedAgentIds).toEqual(["a1"]);
  });
});

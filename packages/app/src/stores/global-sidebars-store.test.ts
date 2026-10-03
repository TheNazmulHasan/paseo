import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import {
  getGlobalExplorerOpen,
  migrateGlobalSidebarsState,
  resolveExplorerSync,
  setGlobalExplorerOpen,
  useGlobalSidebarsStore,
} from "@/stores/global-sidebars-store";

describe("global sidebars store", () => {
  beforeEach(() => {
    useGlobalSidebarsStore.setState({ explorerOpen: null });
  });

  it("starts with no remembered choice and remembers the last write", () => {
    expect(getGlobalExplorerOpen()).toBeNull();
    setGlobalExplorerOpen(true);
    expect(getGlobalExplorerOpen()).toBe(true);
    setGlobalExplorerOpen(false);
    expect(getGlobalExplorerOpen()).toBe(false);
  });

  it("migrates junk to no choice and keeps a valid value", () => {
    expect(migrateGlobalSidebarsState({ explorerOpen: "yes" })).toEqual({ explorerOpen: null });
    expect(migrateGlobalSidebarsState(undefined)).toEqual({ explorerOpen: null });
    expect(migrateGlobalSidebarsState({ explorerOpen: false })).toEqual({ explorerOpen: false });
  });
});

describe("resolveExplorerSync", () => {
  it("leaves the workspace alone with no remembered choice", () => {
    expect(resolveExplorerSync({ globalOpen: null, layoutOpen: true })).toBeNull();
    expect(resolveExplorerSync({ globalOpen: null, layoutOpen: false })).toBeNull();
  });

  it("does nothing when the workspace already matches", () => {
    expect(resolveExplorerSync({ globalOpen: true, layoutOpen: true })).toBeNull();
    expect(resolveExplorerSync({ globalOpen: false, layoutOpen: false })).toBeNull();
  });

  it("shows or hides to match the remembered state", () => {
    expect(resolveExplorerSync({ globalOpen: true, layoutOpen: false })).toBe("show");
    expect(resolveExplorerSync({ globalOpen: false, layoutOpen: true })).toBe("hide");
  });
});

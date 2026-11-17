import { beforeEach, describe, expect, it } from "vitest";
import { buildIndexFromSnapshots, useFolderStore } from "@/folders/folder-store";

const FAITH = { id: "fld_faith", name: "Faith", emoji: null, order: 0, createdAt: "2026-11-01" };

describe("useFolderStore", () => {
  beforeEach(() => {
    useFolderStore.setState({ snapshots: {}, creating: false, explicitFolder: null });
  });

  it("replaces a host's snapshot (every push is the full state) and drops extra fields", () => {
    const store = useFolderStore.getState();
    store.setSnapshot("s1", {
      folders: [FAITH],
      membership: { wks_a: "fld_faith" },
      subscriptionId: "sub-1",
    } as never);
    expect(useFolderStore.getState().snapshots.s1).toEqual({
      folders: [FAITH],
      membership: { wks_a: "fld_faith" },
    });
    useFolderStore.getState().setSnapshot("s1", { folders: [], membership: {} });
    expect(useFolderStore.getState().snapshots.s1).toEqual({ folders: [], membership: {} });
  });

  it("is idempotent: the same push twice gives the same index", () => {
    const snapshot = { folders: [FAITH], membership: { wks_a: "fld_faith" } };
    useFolderStore.getState().setSnapshot("s1", snapshot);
    const first = buildIndexFromSnapshots(useFolderStore.getState().snapshots);
    useFolderStore.getState().setSnapshot("s1", snapshot);
    const second = buildIndexFromSnapshots(useFolderStore.getState().snapshots);
    expect([...second.workspaceFolderKey]).toEqual([...first.workspaceFolderKey]);
    expect(second.groups).toEqual(first.groups);
  });

  it("keeps hosts apart", () => {
    useFolderStore.getState().setSnapshot("s1", { folders: [FAITH], membership: {} });
    useFolderStore.getState().setSnapshot("s2", { folders: [], membership: {} });
    expect(Object.keys(useFolderStore.getState().snapshots).sort()).toEqual(["s1", "s2"]);
  });
});

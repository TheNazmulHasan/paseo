import { beforeEach, describe, expect, it } from "vitest";
import { migrateFolderUiState, useFolderUiStore } from "@/folders/folder-ui-store";

describe("migrateFolderUiState", () => {
  it("turns junk into the defaults: section open, every folder folded", () => {
    for (const junk of [null, undefined, 42, "x", [], { openKeys: "nope" }, { extra: true }]) {
      expect(migrateFolderUiState(junk)).toEqual({ sectionCollapsed: false, openKeys: [] });
    }
  });

  it("keeps a valid persisted state", () => {
    expect(migrateFolderUiState({ sectionCollapsed: true, openKeys: ["faith"] })).toEqual({
      sectionCollapsed: true,
      openKeys: ["faith"],
    });
  });
});

describe("useFolderUiStore", () => {
  beforeEach(() => {
    useFolderUiStore.setState({ sectionCollapsed: false, openKeys: [] });
  });

  it("starts with everything folded and unfolds one folder at a time", () => {
    const store = useFolderUiStore.getState();
    store.toggleFolder("faith");
    store.toggleFolder("__unfiled__");
    expect(useFolderUiStore.getState().openKeys).toEqual(["faith", "__unfiled__"]);
    useFolderUiStore.getState().toggleFolder("faith");
    expect(useFolderUiStore.getState().openKeys).toEqual(["__unfiled__"]);
  });

  it("folds the whole section without forgetting which folders were open", () => {
    useFolderUiStore.getState().toggleFolder("faith");
    useFolderUiStore.getState().toggleSection();
    expect(useFolderUiStore.getState()).toMatchObject({
      sectionCollapsed: true,
      openKeys: ["faith"],
    });
  });

  it("a rename carries the fold to the new key and leaves closed folders closed", () => {
    useFolderUiStore.getState().toggleFolder("faith");
    useFolderUiStore.getState().renameFolderKey("faith", "deen");
    expect(useFolderUiStore.getState().openKeys).toEqual(["deen"]);
    useFolderUiStore.getState().renameFolderKey("work", "job");
    expect(useFolderUiStore.getState().openKeys).toEqual(["deen"]);
  });
});

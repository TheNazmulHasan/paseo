import { describe, expect, it } from "vitest";
import {
  FORK_SESSION_EVENTS,
  SessionEventSubscriptionSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";
import { boardFolderItemKey, findFolderByRef, sortFolders, type Folder } from "./folders.js";

const folder: Folder = {
  id: "fld_0123456789abcdef",
  name: "Faith",
  emoji: "🕌",
  order: 0,
  createdAt: "2026-11-17T00:00:00.000Z",
};

describe("folders messages", () => {
  it("parses every folders request", () => {
    for (const message of [
      { type: "folders.list.request", requestId: "r" },
      { type: "folders.create.request", requestId: "r", name: "Faith" },
      { type: "folders.create.request", requestId: "r", name: "Faith", emoji: null, order: 2 },
      { type: "folders.update.request", requestId: "r", folderId: folder.id, emoji: null },
      { type: "folders.delete.request", requestId: "r", folderId: folder.id },
      { type: "folders.reorder.request", requestId: "r", folderIds: [folder.id] },
      { type: "folders.assign.request", requestId: "r", itemKeys: ["wks_1"], folderId: null },
    ]) {
      expect(SessionInboundMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("rejects a request that leaves out a required field", () => {
    expect(
      SessionInboundMessageSchema.safeParse({ type: "folders.assign.request", requestId: "r" })
        .success,
    ).toBe(false);
  });

  it("parses the responses and the live push", () => {
    const state = { folders: [folder], membership: { wks_1: folder.id } };
    for (const message of [
      { type: "folders.list.response", payload: { requestId: "r", ...state, error: null } },
      { type: "folders.create.response", payload: { requestId: "r", folder, error: null } },
      { type: "folders.update.response", payload: { requestId: "r", folder: null, error: "x" } },
      {
        type: "folders.delete.response",
        payload: { requestId: "r", folder, releasedItemKeys: ["wks_1"], error: null },
      },
      {
        type: "folders.reorder.response",
        payload: { requestId: "r", folders: [folder], error: null },
      },
      {
        type: "folders.assign.response",
        payload: { requestId: "r", itemKeys: ["wks_1"], folderId: null, error: null },
      },
      { type: "folders_update", payload: state },
    ]) {
      expect(SessionOutboundMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("delivers folders_update as a subscribed fork event", () => {
    expect(FORK_SESSION_EVENTS).toContain("folders_update");
    expect(SessionEventSubscriptionSchema.safeParse("folders_update").success).toBe(true);
  });
});

describe("folders helpers", () => {
  it("keys a view as board:<id>", () => {
    expect(boardFolderItemKey("b1")).toBe("board:b1");
  });

  it("finds a folder by id first, then by name in any case", () => {
    const other: Folder = { ...folder, id: "fld_aaaaaaaaaaaaaaaa", name: "fld_0123456789abcdef" };
    expect(findFolderByRef([other, folder], folder.id)).toBe(folder);
    expect(findFolderByRef([folder], "  fAITH ")).toBe(folder);
    expect(findFolderByRef([folder], "nope")).toBeNull();
    expect(findFolderByRef([folder], "   ")).toBeNull();
  });

  it("sorts by order, then age, then id", () => {
    const later: Folder = { ...folder, id: "fld_b", order: 0, createdAt: "2026-11-18" };
    const first: Folder = { ...folder, id: "fld_c", order: -1 };
    expect(sortFolders([later, folder, first]).map((entry) => entry.id)).toEqual([
      "fld_c",
      folder.id,
      "fld_b",
    ]);
  });
});

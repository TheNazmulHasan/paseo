import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionAuthorization } from "../authorization/index.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { findByType } from "../test-utils/session-stubs.js";
import { createFolderRegistry, type FileBackedFolderRegistry } from "./folder-registry.js";
import { FolderSession } from "./folder-session.js";

const logger = createTestLogger();

let home: string;
let registry: FileBackedFolderRegistry;
let emitted: SessionOutboundMessage[];
let session: FolderSession;

async function send(message: SessionInboundMessage): Promise<void> {
  await session.dispatch(message);
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "paseo-folder-session-"));
  registry = createFolderRegistry(home, logger);
  emitted = [];
  session = new FolderSession({
    host: { emit: (message) => emitted.push(message) },
    registry,
    logger,
  });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("FolderSession", () => {
  it("answers each request with a response that carries its requestId", async () => {
    await send({ type: "folders.create.request", requestId: "r1", name: "Faith", emoji: "🕌" });
    const created = findByType(emitted, "folders.create.response");
    expect(created?.payload).toMatchObject({
      requestId: "r1",
      error: null,
      folder: { name: "Faith", emoji: "🕌" },
    });
    const folderId = created?.payload.folder?.id ?? "";

    await send({
      type: "folders.assign.request",
      requestId: "r2",
      itemKeys: ["wks_1", "board:b1"],
      folderId,
    });
    expect(findByType(emitted, "folders.assign.response")?.payload).toEqual({
      requestId: "r2",
      itemKeys: ["wks_1", "board:b1"],
      folderId,
      error: null,
    });

    await send({ type: "folders.list.request", requestId: "r3" });
    expect(findByType(emitted, "folders.list.response")?.payload).toMatchObject({
      requestId: "r3",
      error: null,
      folders: [{ id: folderId }],
      membership: { wks_1: folderId, "board:b1": folderId },
    });

    await send({ type: "folders.update.request", requestId: "r4", folderId, name: "Deen" });
    expect(findByType(emitted, "folders.update.response")?.payload.folder?.name).toBe("Deen");

    await send({ type: "folders.reorder.request", requestId: "r5", folderIds: [folderId] });
    expect(findByType(emitted, "folders.reorder.response")?.payload.folders).toHaveLength(1);

    await send({ type: "folders.delete.request", requestId: "r6", folderId });
    expect(findByType(emitted, "folders.delete.response")?.payload).toMatchObject({
      requestId: "r6",
      folder: { id: folderId },
      releasedItemKeys: ["board:b1", "wks_1"],
      error: null,
    });
  });

  it("reports a caller's mistake in the response instead of throwing", async () => {
    await send({ type: "folders.create.request", requestId: "r1", name: "Faith" });
    await send({ type: "folders.create.request", requestId: "r2", name: "faith" });
    await send({ type: "folders.update.request", requestId: "r3", folderId: "fld_x", name: "Y" });
    await send({ type: "folders.delete.request", requestId: "r4", folderId: "fld_x" });
    await send({ type: "folders.assign.request", requestId: "r5", itemKeys: ["a"], folderId: "x" });

    const errors = emitted.map((message) =>
      "payload" in message && "error" in message.payload ? message.payload.error : undefined,
    );
    expect(errors).toEqual([
      null,
      'A folder named "Faith" exists',
      "Folder fld_x not found",
      "Folder fld_x not found",
      "Folder x not found",
    ]);
    expect(emitted.every((message) => message.type.endsWith(".response"))).toBe(true);
  });

  it("ignores messages that are not folders.* requests", () => {
    expect(session.dispatch({ type: "ping" } as SessionInboundMessage)).toBeUndefined();
  });
});

describe("folders permissions", () => {
  const mutations: SessionInboundMessage["type"][] = [
    "folders.create.request",
    "folders.update.request",
    "folders.delete.request",
    "folders.reorder.request",
    "folders.assign.request",
  ];
  const inbound = (type: SessionInboundMessage["type"]) => ({ type }) as SessionInboundMessage;
  const outbound = (type: SessionOutboundMessage["type"]) => ({ type }) as SessionOutboundMessage;

  it("changing folders needs workspace.manage, the same as pinning", () => {
    const reader = new SessionAuthorization(["workspace.read"]);
    const manager = new SessionAuthorization(["workspace.manage"]);
    const pin = inbound("workspace.pin.set.request");

    expect(reader.allowsInbound(pin)).toBe(false);
    for (const type of mutations) {
      expect(reader.allowsInbound(inbound(type))).toBe(false);
      expect(manager.allowsInbound(inbound(type))).toBe(true);
    }
  });

  it("reading folders and receiving the live state needs only workspace.read", () => {
    const reader = new SessionAuthorization(["workspace.read"]);

    expect(reader.allowsInbound(inbound("folders.list.request"))).toBe(true);
    expect(reader.allowsOutbound(outbound("folders.list.response"))).toBe(true);
    expect(reader.allowsOutbound(outbound("folders_update"))).toBe(true);
    expect(reader.allowsOutbound(outbound("folders.assign.response"))).toBe(false);
  });
});

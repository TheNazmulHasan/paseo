import { expect, onTestFinished, test } from "vitest";
import type { FoldersSnapshot } from "@getpaseo/protocol/folders";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

async function connect(port: number): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws` });
  onTestFinished(() => client.close());
  await client.connect();
  return client;
}

test("folder changes reach every subscribed device, including the one that made them", async () => {
  const daemon = await createTestPaseoDaemon();
  onTestFinished(() => daemon.close());
  const writer = await connect(daemon.port);
  const subscribed = await connect(daemon.port);
  const unsubscribed = await connect(daemon.port);

  expect(writer.getLastServerInfoMessage()?.features?.folders).toBe(true);
  await Promise.all([
    writer.observeEvents(["folders_update"]).ready,
    subscribed.observeEvents(["folders_update"]).ready,
  ]);
  const seenByWriter: FoldersSnapshot[] = [];
  const seenBySubscribed: FoldersSnapshot[] = [];
  const seenByUnsubscribed: FoldersSnapshot[] = [];
  // The subscription layer adds a subscriptionId beside the state; only the state matters here.
  const state = ({ folders, membership }: FoldersSnapshot): FoldersSnapshot => ({
    folders,
    membership,
  });
  writer.on("folders_update", (message) => seenByWriter.push(state(message.payload)));
  subscribed.on("folders_update", (message) => seenBySubscribed.push(state(message.payload)));
  unsubscribed.on("folders_update", (message) => seenByUnsubscribed.push(state(message.payload)));

  const folder = await writer.createFolder({ name: "Faith", emoji: "🕌" });
  await writer.assignToFolder(["wks_1", "board:b1"], folder.id);

  await expect.poll(() => seenBySubscribed.length).toBe(2);
  expect(seenBySubscribed.at(-1)).toEqual({
    folders: [folder],
    membership: { wks_1: folder.id, "board:b1": folder.id },
  });
  expect(seenByWriter).toEqual(seenBySubscribed);
  expect(seenByUnsubscribed).toEqual([]);
  expect(await unsubscribed.listFolders()).toEqual(seenBySubscribed.at(-1));

  const deleted = await writer.deleteFolder(folder.id);
  expect(deleted.releasedItemKeys).toEqual(["board:b1", "wks_1"]);
  await expect.poll(() => seenBySubscribed.at(-1)).toEqual({ folders: [], membership: {} });
}, 60_000);

test("a request that fails rejects on the client and pushes nothing", async () => {
  const daemon = await createTestPaseoDaemon();
  onTestFinished(() => daemon.close());
  const client = await connect(daemon.port);
  await client.observeEvents(["folders_update"]).ready;
  const seen: FoldersSnapshot[] = [];
  client.on("folders_update", (message) => seen.push(message.payload));

  await client.createFolder({ name: "Faith" });
  await expect(client.createFolder({ name: "faith" })).rejects.toThrow('A folder named "Faith"');
  await expect(client.assignToFolder(["wks_1"], "fld_missing")).rejects.toThrow("not found");
  await expect(client.reorderFolders(["fld_missing"])).rejects.toThrow("not found");

  await expect.poll(() => seen.length).toBe(1);
}, 60_000);

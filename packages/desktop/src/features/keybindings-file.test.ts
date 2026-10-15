import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle() {} },
}));
vi.mock("electron-log/main", () => ({ default: { warn() {}, info() {}, error() {} } }));
vi.mock("@getpaseo/server/daemon-control", () => ({ resolvePaseoHome: () => "/unused" }));

import {
  createKeybindingsFileService,
  KEYBINDINGS_CHANGED_CHANNEL,
  parseKeybindingsText,
  stripJsonComments,
  type KeybindingsFileService,
} from "./keybindings-file";

let tmpHome: string | null = null;
let activeService: KeybindingsFileService | null = null;

afterEach(async () => {
  activeService?.stop();
  activeService = null;
  if (tmpHome) await rm(tmpHome, { recursive: true, force: true });
  tmpHome = null;
});

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-keybindings-"));
  tmpHome = dir;
  const broadcast = vi.fn();
  const created = createKeybindingsFileService({ home: dir, broadcast, debounceMs: 20 });
  activeService = created;
  return { home: dir, broadcast, service: created };
}

describe("parseKeybindingsText", () => {
  it("parses an array, comments and trailing commas included", () => {
    const text = `// mine\n[\n  { "action": "a", "key": "Cmd+K" }, /* x */\n  { "action": "b", "key": null, },\n]`;
    expect(parseKeybindingsText(text)).toEqual({
      ok: true,
      entries: [
        { action: "a", key: "Cmd+K" },
        { action: "b", key: null },
      ],
    });
  });

  it("treats an empty file as no entries and rejects junk", () => {
    expect(parseKeybindingsText("  \n")).toEqual({ ok: true, entries: [] });
    expect(parseKeybindingsText("{oops").ok).toBe(false);
    expect(parseKeybindingsText('{"action":"a"}').ok).toBe(false);
  });

  it("leaves comment markers inside strings alone", () => {
    expect(stripJsonComments('["// not a comment"]')).toBe('["// not a comment"]');
  });
});

describe("keybindings file service", () => {
  it("is a no-op when the file is missing", async () => {
    const { service, broadcast } = await setup();
    await service.start();
    expect(await service.getEntries()).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("loads at startup and pushes changes when the file is replaced", async () => {
    const { home, service, broadcast } = await setup();
    const file = path.join(home, "keybindings.json");
    await writeFile(file, '[{"action":"theme.cycle","key":"Cmd+Alt+T"}]');
    await service.start();
    expect(await service.getEntries()).toEqual([{ action: "theme.cycle", key: "Cmd+Alt+T" }]);

    await writeFile(`${file}.tmp`, '[{"action":"theme.cycle","key":null}]');
    const { rename } = await import("node:fs/promises");
    await rename(`${file}.tmp`, file);
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenLastCalledWith(KEYBINDINGS_CHANGED_CHANNEL, {
        entries: [{ action: "theme.cycle", key: null }],
      }),
    );
  });

  it("keeps the last good entries when the file turns to junk", async () => {
    const { home, service } = await setup();
    const file = path.join(home, "keybindings.json");
    await writeFile(file, '[{"action":"theme.cycle","key":null}]');
    await service.start();
    await writeFile(file, "{broken");
    await service.reload();
    expect(await service.getEntries()).toEqual([{ action: "theme.cycle", key: null }]);
  });

  it("writes the defaults file but never keybindings.json", async () => {
    const { home, service } = await setup();
    await service.start();
    await service.writeDefaults("// hi\n{}\n");
    expect(await readFile(path.join(home, "keybindings.defaults.json"), "utf8")).toBe(
      "// hi\n{}\n",
    );
    await expect(readFile(path.join(home, "keybindings.json"), "utf8")).rejects.toThrow();
  });
});

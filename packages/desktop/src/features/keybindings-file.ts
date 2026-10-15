import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { resolvePaseoHome } from "@getpaseo/server/daemon-control";

/**
 * ~/.paseo/keybindings.json: user keyboard shortcut entries, read at startup and
 * watched, pushed live to every renderer window. The renderer owns validation
 * against its action list (it alone knows the actions); this side only parses
 * the JSON and forwards the entries.
 *
 * IPC: invoke `paseo:keybindings:get` -> { entries }, invoke
 * `paseo:keybindings:write-defaults` (content) -> writes keybindings.defaults.json,
 * push `paseo:event:keybindings-changed` { entries } on every change.
 */

export const KEYBINDINGS_FILE_NAME = "keybindings.json";
export const KEYBINDINGS_DEFAULTS_FILE_NAME = "keybindings.defaults.json";
export const KEYBINDINGS_CHANGED_CHANNEL = "paseo:event:keybindings-changed";
const GET_CHANNEL = "paseo:keybindings:get";
const WRITE_DEFAULTS_CHANNEL = "paseo:keybindings:write-defaults";
const MAX_DEFAULTS_BYTES = 1024 * 1024;
const DEBOUNCE_MS = 200;
const REARM_DELAY_MS = 1000;

/** Removes // and block comments and trailing commas, leaving string contents alone. */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        j += text[j] === "\\" ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[\]}])/g, "$1");
}

export type ParsedKeybindingsText = { ok: true; entries: unknown[] } | { ok: false; error: string };

export function parseKeybindingsText(text: string): ParsedKeybindingsText {
  if (text.trim() === "") return { ok: true, entries: [] };
  let value: unknown;
  try {
    value = JSON.parse(stripJsonComments(text));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "top level must be a JSON array" };
  }
  return { ok: true, entries: value };
}

export interface KeybindingsFileService {
  start(): Promise<void>;
  stop(): void;
  getEntries(): Promise<unknown[]>;
  /** Re-reads the file now and broadcasts if the parsed entries changed. */
  reload(): Promise<void>;
  writeDefaults(content: unknown): Promise<void>;
}

export function createKeybindingsFileService(options: {
  home: string;
  broadcast: (channel: string, payload: unknown) => void;
  debounceMs?: number;
}): KeybindingsFileService {
  const { home, broadcast } = options;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const filePath = path.join(home, KEYBINDINGS_FILE_NAME);
  let entries: unknown[] = [];
  let serialized = "[]";
  let loaded: Promise<void> = Promise.resolve();
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rearmTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function reload(): Promise<void> {
    let text = "";
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("[keybindings] cannot read keybindings.json", error);
        return;
      }
    }
    const parsed = parseKeybindingsText(text);
    if (!parsed.ok) {
      // Keep the last good state: the file is probably mid-edit.
      log.warn(`[keybindings] keybindings.json ignored: ${parsed.error}`);
      return;
    }
    const nextSerialized = JSON.stringify(parsed.entries);
    if (nextSerialized === serialized) return;
    entries = parsed.entries;
    serialized = nextSerialized;
    broadcast(KEYBINDINGS_CHANGED_CHANNEL, { entries });
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void reload();
    }, debounceMs);
  }

  // Watch the directory, not the file: editors replace files atomically (the
  // watched inode dies) and the file may not exist yet. Re-arm if the watcher dies.
  function arm(): void {
    if (stopped) return;
    try {
      watcher = watch(home, { persistent: false }, (_event, filename) => {
        if (filename === null || filename === undefined || filename === KEYBINDINGS_FILE_NAME) {
          schedule();
        }
      });
      watcher.on("error", (error) => {
        log.warn("[keybindings] watcher error, re-arming", error);
        watcher?.close();
        watcher = null;
        rearmTimer = setTimeout(arm, REARM_DELAY_MS);
      });
    } catch (error) {
      log.warn("[keybindings] cannot watch Paseo home", error);
    }
  }

  return {
    async start() {
      await mkdir(home, { recursive: true });
      loaded = reload();
      await loaded;
      arm();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (rearmTimer) clearTimeout(rearmTimer);
      watcher?.close();
      watcher = null;
    },
    async getEntries() {
      await loaded;
      return entries;
    },
    reload,
    async writeDefaults(content) {
      if (typeof content !== "string" || content.length > MAX_DEFAULTS_BYTES) return;
      const target = path.join(home, KEYBINDINGS_DEFAULTS_FILE_NAME);
      const existing = await readFile(target, "utf8").catch(() => null);
      if (existing === content) return;
      await mkdir(home, { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, target);
    },
  };
}

export function registerKeybindingsFile(): KeybindingsFileService {
  const service = createKeybindingsFileService({
    home: resolvePaseoHome(process.env),
    broadcast: (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    },
  });
  ipcMain.handle(GET_CHANNEL, async () => ({ entries: await service.getEntries() }));
  ipcMain.handle(WRITE_DEFAULTS_CHANNEL, (_event, content: unknown) =>
    service.writeDefaults(content),
  );
  service.start().catch((error) => log.warn("[keybindings] failed to start", error));
  return service;
}

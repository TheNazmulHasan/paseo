import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Nazmul mod (chief): readers for the transcripts `search_sessions` scans.
 *
 * Paseo keeps no transcript of its own on disk. The agent record under `~/.paseo/agents` holds
 * only metadata, and the live timeline is in memory. When Paseo replays an archived chat it asks
 * the provider, so the provider's own store is the source of truth:
 * - Claude Code family (claude, claude-proxy, cliproxy-claude...): `<claude config>/projects/<cwd>/<sessionId>.jsonl`
 * - Codex family (codex, cliproxy-codex, grok): `<codex home>/sessions/**` and `archived_sessions/`,
 *   `rollout-<time>-<threadId>.jsonl`
 * Gaps: Antigravity has no resumable session (nothing to replay, nothing on disk keyed to a Paseo
 * agent), and Claude Code deletes transcripts after its retention window (about 30 days).
 * For the second gap a fallback is read: SpecStory's markdown export (`.specstory/history/*.md`
 * in the project), matched by the session id in its header. It is only as fresh as the last
 * `refresh-history`, and only reads user and agent text, never tool blocks.
 */

export interface TranscriptMessage {
  /** ISO timestamp of the message, when the store records one. */
  at: string | null;
  who: "you" | "agent";
  text: string;
}

export type TranscriptKind = "claude" | "codex" | "specstory";

export interface TranscriptRef {
  kind: TranscriptKind;
  path: string;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------------------------
// Line streaming
// ---------------------------------------------------------------------------------------------

async function* streamLines(path: string): AsyncGenerator<string> {
  const input = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) yield line;
  } finally {
    reader.close();
    input.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------------------------

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function claudeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

export async function* readClaudeTranscript(path: string): AsyncGenerator<TranscriptMessage> {
  for await (const line of streamLines(path)) {
    // Cheap rejection first: most bytes are tool results and file snapshots.
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    if (!line.includes('"type":"text"') && !line.includes('"content":"')) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const role = entry.type;
    if (role !== "user" && role !== "assistant") continue;
    // Sidechains are sub-agent work, meta entries are harness-injected, a compact summary is the
    // model's own recap of text already in the file.
    if (entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true) {
      continue;
    }
    const message = entry.message as { content?: unknown } | undefined;
    const text = claudeText(message?.content).replace(SYSTEM_REMINDER, "").trim();
    if (!text) continue;
    yield {
      at: typeof entry.timestamp === "string" ? entry.timestamp : null,
      who: role === "user" ? "you" : "agent",
      text,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------------

// Harness-injected "user" messages at the top of every rollout.
const CODEX_INJECTED_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<user_instructions>",
  "<INSTRUCTIONS>",
  "<turn_aborted>",
  "<permissions",
  "<skills_instructions>",
];

export async function* readCodexTranscript(path: string): AsyncGenerator<TranscriptMessage> {
  for await (const line of streamLines(path)) {
    if (!line.includes('"type":"message"')) continue;
    let entry: {
      timestamp?: unknown;
      type?: unknown;
      payload?: { type?: unknown; role?: unknown; content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry.payload;
    if (entry.type !== "response_item" || payload?.type !== "message") continue;
    if (payload.role !== "user" && payload.role !== "assistant") continue;
    if (!Array.isArray(payload.content)) continue;
    const text = payload.content
      .map((block: { text?: unknown }) => (typeof block?.text === "string" ? block.text : ""))
      .join("\n")
      .trim();
    if (!text) continue;
    if (payload.role === "user" && CODEX_INJECTED_PREFIXES.some((p) => text.startsWith(p))) {
      continue;
    }
    yield {
      at: typeof entry.timestamp === "string" ? entry.timestamp : null,
      who: payload.role === "user" ? "you" : "agent",
      text,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// SpecStory markdown (fallback for transcripts the provider has deleted)
// ---------------------------------------------------------------------------------------------

const SPECSTORY_SPEAKER = /^_\*\*(User|Agent)\b.*\*\*_\s*$/;
const SPECSTORY_STAMP = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})Z/;

function specStoryIso(header: string): string | null {
  const match = SPECSTORY_STAMP.exec(header);
  return match ? `${match[1]}T${match[2]}.000Z` : null;
}

export async function* readSpecStoryTranscript(path: string): AsyncGenerator<TranscriptMessage> {
  let who: "you" | "agent" | null = null;
  let at: string | null = null;
  let buffer: string[] = [];
  let inTool = false;

  const flush = (): TranscriptMessage | null => {
    if (!who) return null;
    const text = buffer.join("\n").replace(/\n-{3,}\s*$/, "").trim();
    buffer = [];
    return text ? { at, who, text } : null;
  };

  for await (const line of streamLines(path)) {
    if (inTool) {
      if (line.includes("</tool-use>")) inTool = false;
      continue;
    }
    if (line.startsWith("<tool-use")) {
      // One-line tool blocks close on the same line.
      if (!line.includes("</tool-use>")) inTool = true;
      continue;
    }
    const speaker = SPECSTORY_SPEAKER.exec(line);
    if (speaker) {
      const done = flush();
      if (done) yield done;
      who = speaker[1] === "User" ? "you" : "agent";
      at = specStoryIso(line);
      continue;
    }
    if (who) buffer.push(line);
  }
  const last = flush();
  if (last) yield last;
}

export function readTranscript(ref: TranscriptRef): AsyncGenerator<TranscriptMessage> {
  switch (ref.kind) {
    case "claude":
      return readClaudeTranscript(ref.path);
    case "codex":
      return readCodexTranscript(ref.path);
    case "specstory":
      return readSpecStoryTranscript(ref.path);
  }
}

// ---------------------------------------------------------------------------------------------
// Finding the file for a session id
// ---------------------------------------------------------------------------------------------

export interface TranscriptLocator {
  /** The transcript for a provider session id; `cwd` lets the SpecStory fallback find its folder. */
  find(sessionId: string, cwd: string): Promise<TranscriptRef | null>;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function indexClaude(configDirs: readonly string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const configDir of configDirs) {
    const root = join(configDir, "projects");
    for (const project of await safeReaddir(root)) {
      for (const file of await safeReaddir(join(root, project))) {
        if (file.endsWith(".jsonl")) index.set(file.slice(0, -".jsonl".length), join(root, project, file));
      }
    }
  }
  return index;
}

async function walkRollouts(dir: string, into: Map<string, string>, depth = 0): Promise<void> {
  if (depth > 4) return;
  for (const name of await safeReaddir(dir)) {
    const path = join(dir, name);
    if (name.startsWith("rollout-") && name.endsWith(".jsonl")) {
      const id = UUID_PATTERN.exec(name.slice(-"-00000000-0000-0000-0000-000000000000.jsonl".length));
      if (id) into.set(id[0].toLowerCase(), path);
      continue;
    }
    if (!name.includes(".")) await walkRollouts(path, into, depth + 1);
  }
}

async function indexCodex(homes: readonly string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const home of homes) {
    await walkRollouts(join(home, "sessions"), index);
    await walkRollouts(join(home, "archived_sessions"), index);
  }
  return index;
}

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** `<dir>/.specstory/history` for the nearest project folder at or above `cwd`. */
async function findSpecStoryHistory(cwd: string): Promise<string | null> {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, ".specstory", "history");
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function indexSpecStory(historyDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const name of await safeReaddir(historyDir)) {
    if (!name.endsWith(".md")) continue;
    const path = join(historyDir, name);
    try {
      const head = await readHead(path, 600);
      const match = /Session ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(head);
      if (match) index.set(match[1].toLowerCase(), path);
    } catch {
      // unreadable file: skip it
    }
  }
  return index;
}

export interface TranscriptLocatorOptions {
  /** Claude Code config dirs (each holds `projects/`). */
  claudeConfigDirs?: readonly string[];
  /** Codex homes (each holds `sessions/` and `archived_sessions/`). */
  codexHomes?: readonly string[];
  /** Turn the SpecStory fallback off. */
  specStory?: boolean;
}

export function defaultClaudeConfigDirs(extra: readonly string[] = []): string[] {
  return [
    ...new Set([process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ...extra].filter(Boolean)),
  ];
}

export function defaultCodexHomes(): string[] {
  return [process.env.CODEX_HOME ?? join(homedir(), ".codex")];
}

/**
 * One locator per search: the three indexes are built on first use and dropped with it, so a
 * transcript written a moment ago is found and nothing is cached across calls.
 */
export function createTranscriptLocator(options: TranscriptLocatorOptions = {}): TranscriptLocator {
  let claude: Promise<Map<string, string>> | null = null;
  let codex: Promise<Map<string, string>> | null = null;
  const specStoryByDir = new Map<string, Promise<Map<string, string>>>();
  const specStoryDirByCwd = new Map<string, Promise<string | null>>();

  return {
    async find(sessionId, cwd) {
      const id = sessionId.toLowerCase();
      claude ??= indexClaude(options.claudeConfigDirs ?? defaultClaudeConfigDirs());
      const claudePath = (await claude).get(sessionId) ?? (await claude).get(id);
      if (claudePath) return { kind: "claude", path: claudePath };

      codex ??= indexCodex(options.codexHomes ?? defaultCodexHomes());
      const codexPath = (await codex).get(id);
      if (codexPath) return { kind: "codex", path: codexPath };

      if (options.specStory === false) return null;
      let historyDir = specStoryDirByCwd.get(cwd);
      if (!historyDir) {
        historyDir = findSpecStoryHistory(cwd);
        specStoryDirByCwd.set(cwd, historyDir);
      }
      const dir = await historyDir;
      if (!dir) return null;
      let index = specStoryByDir.get(dir);
      if (!index) {
        index = indexSpecStory(dir);
        specStoryByDir.set(dir, index);
      }
      const path = (await index).get(id);
      return path ? { kind: "specstory", path } : null;
    },
  };
}

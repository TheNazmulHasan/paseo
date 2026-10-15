import { spawn } from "node:child_process";

/**
 * Read-only `agy` probes and parsers: `agy models`, `agy --print "/usage"`, and
 * quota-exhaustion detection on a failed turn. Parsers are pure so tests feed
 * them captured output.
 */

/** Google meters Gemini separately from "Claude and GPT models". */
export type ModelFamily = "gemini" | "claude-gpt";

export interface UsageWindow {
  remainingPercent: number;
  /** ISO timestamp the window resets at, when agy printed one. */
  resetsAt: string | null;
}

export interface FamilyUsage {
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
}

export type AccountUsage = Record<ModelFamily, FamilyUsage>;

export interface AgyModel {
  /** agy's own id, e.g. gemini-3.1-pro-high. */
  agyId: string;
  /** agy's label, e.g. "Gemini 3.1 Pro (High)". Paseo uses the label as the model id. */
  label: string;
}

export function modelFamilyOf(model: string): ModelFamily {
  return /claude|gpt|opus|sonnet|haiku/i.test(model) ? "claude-gpt" : "gemini";
}

export const MODEL_FAMILY_LABEL: Record<ModelFamily, string> = {
  gemini: "Gemini",
  "claude-gpt": "Claude",
};

function familyFromCategory(category: string): ModelFamily | null {
  if (/gemini/i.test(category)) return "gemini";
  if (/claude|gpt/i.test(category)) return "claude-gpt";
  return null;
}

/**
 * Parse `agy --print "/usage"`: TAB-separated `category, window, "NN%", resetISO`.
 * Returns null when no line was understood (probe output unusable).
 */
export function parseUsage(text: string): AccountUsage | null {
  const usage: AccountUsage = { gemini: {}, "claude-gpt": {} };
  let understood = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.split("\t").map((part) => part.trim());
    if (parts.length < 3) continue;
    const family = familyFromCategory(parts[0] ?? "");
    const windowName = parts[1] ?? "";
    const percent = /(\d+(?:\.\d+)?)\s*%/.exec(parts[2] ?? "");
    if (!family || !percent) continue;
    const window: UsageWindow = {
      remainingPercent: Number(percent[1]),
      resetsAt: parts[3] ? parts[3] : null,
    };
    if (/five\s*hour|5\s*hour/i.test(windowName)) {
      usage[family].fiveHour = window;
      understood += 1;
    } else if (/week/i.test(windowName)) {
      usage[family].weekly = window;
      understood += 1;
    }
  }
  return understood > 0 ? usage : null;
}

/** Remaining quota for a family: the lower of the 5-hour and weekly windows. */
export function familyRemaining(usage: AccountUsage, family: ModelFamily): number | null {
  const { fiveHour, weekly } = usage[family];
  const values = [fiveHour?.remainingPercent, weekly?.remainingPercent].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length > 0 ? Math.min(...values) : null;
}

/** The reset time of whichever window is the binding (lowest) one. */
export function familyResetsAt(usage: AccountUsage, family: ModelFamily): string | null {
  const { fiveHour, weekly } = usage[family];
  const windows = [fiveHour, weekly].filter((w): w is UsageWindow => w !== undefined);
  if (windows.length === 0) return null;
  const lowest = windows.reduce((a, b) => (b.remainingPercent < a.remainingPercent ? b : a));
  return lowest.resetsAt;
}

/** Parse `agy models`: skips the "Fetching available models..." line and anything without a TAB. */
export function parseModels(text: string): AgyModel[] {
  const models: AgyModel[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.split("\t");
    if (parts.length < 2) continue;
    const agyId = (parts[0] ?? "").trim();
    const label = parts.slice(1).join("\t").trim();
    if (!agyId || !label || seen.has(agyId)) continue;
    seen.add(agyId);
    models.push({ agyId, label });
  }
  return models;
}

// What agy prints when a Google AI Pro window runs dry (seen in its own cli.log):
//   RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your
//   subscription to increase your limits. Resets in 21h19m2s.
const QUOTA_PATTERN =
  /RESOURCE_EXHAUSTED|Individual quota reached|quota (?:has been |was )?(?:reached|exceeded|exhausted)|out of quota/i;
const RESETS_IN_PATTERN = /Resets in\s+((?:\d+\s*[dhms]\s*)+)/i;

/** True when a (short) text is just agy's quota error, not an answer that mentions quotas. */
export function looksLikeQuotaError(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length < 600 && QUOTA_PATTERN.test(trimmed);
}

export function parseResetDurationMs(text: string): number | null {
  const match = RESETS_IN_PATTERN.exec(text);
  if (!match) return null;
  let total = 0;
  for (const part of (match[1] ?? "").matchAll(/(\d+)\s*([dhms])/gi)) {
    const n = Number(part[1]);
    const unit = (part[2] ?? "").toLowerCase();
    total += n * ({ d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }[unit] ?? 0);
  }
  return total > 0 ? total : null;
}

export interface QuotaExhaustion {
  exhausted: boolean;
  /** How long until the window resets, when agy said so. */
  resetsInMs: number | null;
}

/**
 * Decide whether a finished turn failed because the account ran out of quota.
 * The words can also appear inside a legitimate answer, so a clean exit with a
 * real response never counts; only a failed exit, an empty response, or a
 * response that is just the error line does.
 */
export function detectQuotaExhausted(input: {
  stdout: string;
  stderr: string;
  code: number | null;
  responseText: string;
}): QuotaExhaustion {
  const combined = `${input.stderr}\n${input.stdout}`;
  if (!QUOTA_PATTERN.test(combined)) return { exhausted: false, resetsInMs: null };
  const failedExit = input.code !== null && input.code !== 0;
  const response = input.responseText.trim();
  if (!failedExit && response.length > 0 && !looksLikeQuotaError(response)) {
    return { exhausted: false, resetsInMs: null };
  }
  return { exhausted: true, resetsInMs: parseResetDurationMs(combined) };
}

export interface AgyRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface AgyRunOptions {
  home: string;
  timeoutMs: number;
}

/** Runs one `agy` command in an account's HOME. Injected so tests never spawn agy. */
export type AgyRunner = (args: string[], options: AgyRunOptions) => Promise<AgyRunResult>;

export function createAgyRunner(binary: string): AgyRunner {
  return (args, options) =>
    new Promise<AgyRunResult>((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: options.home,
        env: { ...process.env, HOME: options.home },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`agy ${args[0] ?? ""} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
}

/** agy mirrors its listing to both streams; prefer stdout and fall back to stderr. */
export async function probeModels(runner: AgyRunner, options: AgyRunOptions): Promise<AgyModel[]> {
  const result = await runner(["models"], options);
  const models = parseModels(result.stdout);
  const fromStderr = models.length > 0 ? models : parseModels(result.stderr);
  if (fromStderr.length === 0) {
    throw new Error("agy models printed no models");
  }
  return fromStderr;
}

export async function probeUsage(runner: AgyRunner, options: AgyRunOptions): Promise<AccountUsage> {
  const result = await runner(["--print", "/usage"], options);
  const usage = parseUsage(result.stdout) ?? parseUsage(result.stderr);
  if (!usage) {
    throw new Error("agy /usage printed no quota lines");
  }
  return usage;
}

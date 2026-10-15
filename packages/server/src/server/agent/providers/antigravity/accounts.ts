import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Logger } from "pino";

import { resolvePaseoHome } from "../../../paseo-home.js";

/**
 * One Google AI Pro login. `agy` keeps its login under `$HOME/.gemini`, so each
 * account is a separate HOME folder: the real home for the main account, a fake
 * one (`~/.agy-accounts/<name>`) for every spare.
 */
export interface AntigravityAccount {
  id: string;
  email?: string;
  home: string;
  enabled: boolean;
  /** Gemini Notebook profile for this account. Not used by the provider yet. */
  notebookProfile?: string;
}

export interface AntigravityAccountRegistry {
  /** Every valid entry, in file order, including disabled ones. */
  all: AntigravityAccount[];
  /** Enabled entries only, in file order. Registry order is the balancing tie-break. */
  enabled: AntigravityAccount[];
  /** True when the file is missing or unusable and the single implicit `main` account is in force. */
  implicit: boolean;
}

export const MAIN_ACCOUNT_ID = "main";
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function resolveAccountRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePaseoHome(env), "google-accounts.json");
}

export function implicitMainAccount(homeDir: string = homedir()): AntigravityAccount {
  return { id: MAIN_ACCOUNT_ID, home: homeDir, enabled: true };
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

function parseAccountEntry(
  entry: unknown,
  index: number,
  homeDir: string,
  logger: Logger | undefined,
): AntigravityAccount | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    logger?.warn({ index }, "antigravity: google-accounts.json entry is not an object; skipped");
    return null;
  }
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!ACCOUNT_ID_PATTERN.test(id)) {
    logger?.warn({ index, id: record.id }, "antigravity: account entry has no valid id; skipped");
    return null;
  }
  const rawHome = typeof record.home === "string" ? expandHome(record.home.trim(), homeDir) : "";
  if (!rawHome || !path.isAbsolute(rawHome)) {
    logger?.warn({ index, id }, "antigravity: account entry needs an absolute home; skipped");
    return null;
  }
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    logger?.warn({ index, id }, "antigravity: account 'enabled' must be a boolean; skipped");
    return null;
  }
  const account: AntigravityAccount = {
    id,
    home: path.resolve(rawHome),
    enabled: record.enabled !== false,
  };
  if (typeof record.email === "string" && record.email.trim()) {
    account.email = record.email.trim();
  }
  if (typeof record.notebookProfile === "string" && record.notebookProfile.trim()) {
    account.notebookProfile = record.notebookProfile.trim();
  }
  return account;
}

/**
 * Parse the registry JSON. Returns null when the document is unusable as a whole
 * (not JSON, wrong shape, or no valid entry), so the caller falls back to the
 * implicit main account.
 */
export function parseAccountRegistry(
  text: string,
  options: { homeDir?: string; logger?: Logger } = {},
): AntigravityAccount[] | null {
  const homeDir = options.homeDir ?? homedir();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    options.logger?.warn({ err }, "antigravity: google-accounts.json is not valid JSON");
    return null;
  }
  const entries =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { accounts?: unknown }).accounts
      : undefined;
  if (!Array.isArray(entries)) {
    options.logger?.warn("antigravity: google-accounts.json has no 'accounts' array");
    return null;
  }
  const accounts: AntigravityAccount[] = [];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const account = parseAccountEntry(entry, index, homeDir, options.logger);
    if (!account) return;
    if (seen.has(account.id)) {
      options.logger?.warn({ id: account.id }, "antigravity: duplicate account id; skipped");
      return;
    }
    seen.add(account.id);
    accounts.push(account);
  });
  return accounts.length > 0 ? accounts : null;
}

function buildRegistry(accounts: AntigravityAccount[] | null, homeDir: string) {
  if (!accounts) {
    const main = implicitMainAccount(homeDir);
    return { all: [main], enabled: [main], implicit: true } satisfies AntigravityAccountRegistry;
  }
  const enabled = accounts.filter((account) => account.enabled);
  if (enabled.length === 0) {
    const main = implicitMainAccount(homeDir);
    return { all: accounts, enabled: [main], implicit: true } satisfies AntigravityAccountRegistry;
  }
  return { all: accounts, enabled, implicit: false } satisfies AntigravityAccountRegistry;
}

interface CachedRegistry {
  mtimeMs: number;
  size: number;
  registry: AntigravityAccountRegistry;
}

/**
 * Reads `~/.paseo/google-accounts.json` on every call. The file is stat-ed each
 * time and re-parsed only when its mtime or size changed, so adding an account
 * needs no daemon restart.
 */
export class AccountRegistryReader {
  private cache: CachedRegistry | null = null;
  private lastWarnedKey: string | null = null;

  constructor(
    private readonly options: {
      filePath?: string;
      homeDir?: string;
      logger?: Logger;
    } = {},
  ) {}

  read(): AntigravityAccountRegistry {
    const homeDir = this.options.homeDir ?? homedir();
    const filePath = this.options.filePath ?? resolveAccountRegistryPath();
    let stat: { mtimeMs: number; size: number };
    try {
      const s = statSync(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      // Missing file is the normal single-account setup: behave exactly like before.
      this.cache = null;
      return buildRegistry(null, homeDir);
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) {
      return this.cache.registry;
    }
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch (err) {
      this.options.logger?.warn({ err, filePath }, "antigravity: cannot read google-accounts.json");
      return buildRegistry(null, homeDir);
    }
    const key = `${stat.mtimeMs}:${stat.size}`;
    const logger = this.lastWarnedKey === key ? undefined : this.options.logger;
    this.lastWarnedKey = key;
    const registry = buildRegistry(parseAccountRegistry(text, { homeDir, logger }), homeDir);
    this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, registry };
    return registry;
  }
}

/** Short label for the dropdown: the email's local part, else the id. */
export function accountDisplayName(account: AntigravityAccount): string {
  const local = account.email?.split("@")[0]?.trim();
  return local || account.id;
}

/**
 * The account whose HOME is the daemon's real home: where every pre-registry
 * conversation lives, and the fallback when probes fail.
 */
export function findMainAccount(
  accounts: AntigravityAccount[],
  homeDir: string = homedir(),
): AntigravityAccount | undefined {
  return (
    accounts.find((account) => account.id === MAIN_ACCOUNT_ID) ??
    accounts.find((account) => path.resolve(account.home) === path.resolve(homeDir)) ??
    accounts[0]
  );
}

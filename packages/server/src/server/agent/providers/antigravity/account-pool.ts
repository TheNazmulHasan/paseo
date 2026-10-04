import type { Logger } from "pino";

import type { AgentFeatureSelect, AgentSelectOption } from "../../agent-sdk-types.js";
import {
  AccountRegistryReader,
  accountDisplayName,
  findMainAccount,
  type AntigravityAccount,
} from "./accounts.js";
import {
  MODEL_FAMILY_LABEL,
  familyRemaining,
  familyResetsAt,
  modelFamilyOf,
  probeModels,
  probeUsage,
  type AccountUsage,
  type AgyModel,
  type AgyRunner,
  type ModelFamily,
} from "./agy-probes.js";

export const ACCOUNT_FEATURE_ID = "account";
export const ACCOUNT_AUTO = "auto";

const DEFAULT_USAGE_TTL_MS = 60_000;
const DEFAULT_MODELS_TTL_MS = 10 * 60_000;
/** A probe that failed is not retried for this long, so a dead account cannot stall every turn. */
const DEFAULT_FAILURE_TTL_MS = 30_000;
// `agy --print "/usage"` takes ~16 s on a warm machine (silent auth first), so 20 s is too tight.
const DEFAULT_USAGE_TIMEOUT_MS = 30_000;
const DEFAULT_MODELS_TIMEOUT_MS = 20_000;
const FALLBACK_EXHAUSTION_MS = 60 * 60_000;

interface ProbeEntry<T> {
  at: number;
  ok: boolean;
  value: T | null;
}

export interface AccountPoolOptions {
  registry: AccountRegistryReader;
  runner: AgyRunner;
  logger: Logger;
  now?: () => number;
  homeDir?: string;
  usageTtlMs?: number;
  modelsTtlMs?: number;
  failureTtlMs?: number;
  usageTimeoutMs?: number;
  modelsTimeoutMs?: number;
}

export interface AccountPick {
  account: AntigravityAccount;
  /** True when no account could be ranked (all probes failed) and main was used. */
  fellBack: boolean;
}

/**
 * Parse an old/retired model label onto the closest label agy lists today.
 * agy silently swaps retired models in its settings; `--model` with a retired
 * label would not get that courtesy, so Paseo does the swap itself: same name
 * and tier, highest version available. Returns null when nothing is close.
 */
export function mapToAvailableModelLabel(label: string, available: string[]): string | null {
  if (available.includes(label)) return label;
  const parse = (value: string) => {
    const match = /^(.*?)(\d+(?:\.\d+)*)(.*)$/.exec(value);
    if (!match) return null;
    return {
      name: match[1] ?? "",
      version: (match[2] ?? "").split(".").map(Number),
      suffix: match[3] ?? "",
    };
  };
  const wanted = parse(label);
  if (!wanted) return null;
  const compareVersions = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  const pickNewest = (suffix: string) => {
    let best: { label: string; version: number[] } | null = null;
    for (const candidate of available) {
      const parsed = parse(candidate);
      if (!parsed || parsed.name !== wanted.name || parsed.suffix !== suffix) continue;
      if (!best || compareVersions(parsed.version, best.version) > 0) {
        best = { label: candidate, version: parsed.version };
      }
    }
    return best?.label ?? null;
  };
  return pickNewest(wanted.suffix) ?? pickNewest(" (Medium)");
}

function keyOf(account: AntigravityAccount): string {
  return `${account.id}|${account.home}`;
}

/**
 * Knows the registered accounts, caches their quota and model lists, and picks
 * the account with the most quota left for a model family.
 */
export class AccountPool {
  private readonly usage = new Map<string, ProbeEntry<AccountUsage>>();
  private readonly models = new Map<string, ProbeEntry<AgyModel[]>>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly exhausted = new Map<string, number>();
  private readonly now: () => number;
  private readonly homeDir: string | undefined;
  private readonly usageTtlMs: number;
  private readonly modelsTtlMs: number;
  private readonly failureTtlMs: number;
  private readonly usageTimeoutMs: number;
  private readonly modelsTimeoutMs: number;

  constructor(private readonly options: AccountPoolOptions) {
    this.now = options.now ?? Date.now;
    this.homeDir = options.homeDir;
    this.usageTtlMs = options.usageTtlMs ?? DEFAULT_USAGE_TTL_MS;
    this.modelsTtlMs = options.modelsTtlMs ?? DEFAULT_MODELS_TTL_MS;
    this.failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    this.usageTimeoutMs = options.usageTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS;
    this.modelsTimeoutMs = options.modelsTimeoutMs ?? DEFAULT_MODELS_TIMEOUT_MS;
  }

  // --- registry -----------------------------------------------------------

  accounts(): AntigravityAccount[] {
    return this.options.registry.read().enabled;
  }

  getAccount(id: string): AntigravityAccount | undefined {
    return this.accounts().find((account) => account.id === id);
  }

  mainAccount(): AntigravityAccount | undefined {
    return findMainAccount(this.accounts(), this.homeDir);
  }

  // --- exhaustion ---------------------------------------------------------

  markExhausted(
    account: AntigravityAccount,
    family: ModelFamily,
    resetsInMs: number | null,
  ): number {
    const until =
      this.now() +
      (resetsInMs ?? this.resetsInFromUsage(account, family) ?? FALLBACK_EXHAUSTION_MS);
    this.exhausted.set(`${account.id}|${family}`, until);
    return until;
  }

  exhaustedUntil(account: AntigravityAccount, family: ModelFamily): number | null {
    const key = `${account.id}|${family}`;
    const until = this.exhausted.get(key);
    if (until === undefined) return null;
    if (until <= this.now()) {
      this.exhausted.delete(key);
      return null;
    }
    return until;
  }

  private resetsInFromUsage(account: AntigravityAccount, family: ModelFamily): number | null {
    const usage = this.usageFor(account);
    const iso = usage ? familyResetsAt(usage, family) : null;
    const at = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(at) && at > this.now() ? at - this.now() : null;
  }

  // --- probes -------------------------------------------------------------

  usageFor(account: AntigravityAccount): AccountUsage | null {
    return this.usage.get(keyOf(account))?.value ?? null;
  }

  modelsFor(account: AntigravityAccount): AgyModel[] | null {
    return this.models.get(keyOf(account))?.value ?? null;
  }

  private refresh<T>(
    cache: Map<string, ProbeEntry<T>>,
    kind: "usage" | "models",
    account: AntigravityAccount,
    ttlMs: number,
    timeoutMs: number,
    probe: () => Promise<T>,
  ): Promise<void> {
    const key = keyOf(account);
    const cached = cache.get(key);
    if (cached) {
      const age = this.now() - cached.at;
      if (age < (cached.ok ? ttlMs : this.failureTtlMs)) return Promise.resolve();
    }
    const flightKey = `${kind}|${key}`;
    const existing = this.inflight.get(flightKey);
    if (existing) return existing;
    const run = (async () => {
      try {
        const value = await probe();
        cache.set(key, { at: this.now(), ok: true, value });
      } catch (err) {
        this.options.logger.warn(
          { err, account: account.id, kind, timeoutMs },
          "antigravity: account probe failed",
        );
        // Keep the last good value for display, but mark the entry failed.
        cache.set(key, { at: this.now(), ok: false, value: cached?.value ?? null });
      } finally {
        this.inflight.delete(flightKey);
      }
    })();
    this.inflight.set(flightKey, run);
    return run;
  }

  refreshUsage(accounts: AntigravityAccount[] = this.accounts()): Promise<void> {
    return Promise.all(
      accounts.map((account) =>
        this.refresh(this.usage, "usage", account, this.usageTtlMs, this.usageTimeoutMs, () =>
          probeUsage(this.options.runner, { home: account.home, timeoutMs: this.usageTimeoutMs }),
        ),
      ),
    ).then(() => undefined);
  }

  refreshModels(accounts: AntigravityAccount[] = this.accounts()): Promise<void> {
    return Promise.all(
      accounts.map((account) =>
        this.refresh(this.models, "models", account, this.modelsTtlMs, this.modelsTimeoutMs, () =>
          probeModels(this.options.runner, { home: account.home, timeoutMs: this.modelsTimeoutMs }),
        ),
      ),
    ).then(() => undefined);
  }

  /** True when the last probe of this account succeeded (value is trustworthy). */
  private probeOk<T>(cache: Map<string, ProbeEntry<T>>, account: AntigravityAccount): boolean {
    return cache.get(keyOf(account))?.ok === true;
  }

  /**
   * Union of every enabled account's models, deduped by id, in first-seen
   * order. Null when every probe failed (caller falls back to its static list).
   */
  async listModelUnion(): Promise<AgyModel[] | null> {
    const accounts = this.accounts();
    await this.refreshModels(accounts);
    return this.cachedModelUnion(accounts);
  }

  cachedModelUnion(accounts: AntigravityAccount[] = this.accounts()): AgyModel[] | null {
    const union: AgyModel[] = [];
    const seen = new Set<string>();
    for (const account of accounts) {
      const list = this.probeOk(this.models, account) ? this.modelsFor(account) : null;
      for (const model of list ?? []) {
        if (seen.has(model.agyId)) continue;
        seen.add(model.agyId);
        union.push(model);
      }
    }
    return union.length > 0 ? union : null;
  }

  // --- balancing ----------------------------------------------------------

  /** Remaining percent for a family (exhaustion marker wins), or null if unknown. */
  remainingFor(account: AntigravityAccount, family: ModelFamily): number | null {
    if (this.exhaustedUntil(account, family) !== null) return 0;
    const usage = this.usageFor(account);
    return usage ? familyRemaining(usage, family) : null;
  }

  hasAnyUsage(): boolean {
    return this.accounts().some((account) => this.usageFor(account) !== null);
  }

  /** Cached check only: does this account list the model? Unknown counts as yes. */
  cachedHasModel(account: AntigravityAccount, label: string): boolean {
    const list = this.modelsFor(account);
    return list ? list.some((model) => model.label === label) : true;
  }

  /**
   * Pick the enabled account with the most quota left for the model's family.
   * Accounts whose probe failed are skipped; if none can be ranked, main wins.
   * Returns null only when `exclude` removed every account.
   */
  async pick(input: { model: string; exclude?: ReadonlySet<string> }): Promise<AccountPick | null> {
    const family = modelFamilyOf(input.model);
    const candidates = this.accounts().filter((account) => !input.exclude?.has(account.id));
    if (candidates.length === 0) return null;
    await Promise.all([this.refreshUsage(candidates), this.refreshModels(candidates)]);

    const ranked = candidates.filter(
      (account) => this.probeOk(this.usage, account) && this.probeOk(this.models, account),
    );
    // A model nobody lists (stale stored label) must not disqualify everyone.
    const anyoneHasModel = ranked.some((account) => this.cachedHasModel(account, input.model));
    const eligible = ranked.filter(
      (account) => !anyoneHasModel || this.cachedHasModel(account, input.model),
    );

    let best: AntigravityAccount | null = null;
    let bestRemaining = Number.NEGATIVE_INFINITY;
    for (const account of eligible) {
      const remaining = this.remainingFor(account, family) ?? -1;
      // Strictly greater: ties keep the earlier account, so registry order breaks them.
      if (remaining > bestRemaining) {
        best = account;
        bestRemaining = remaining;
      }
    }
    if (best) return { account: best, fellBack: false };

    const main = findMainAccount(candidates, this.homeDir) ?? candidates[0]!;
    this.options.logger.warn(
      { account: main.id },
      "antigravity: no account could be ranked; falling back to main",
    );
    return { account: main, fellBack: true };
  }

  // --- dropdown -----------------------------------------------------------

  summarizeQuota(account: AntigravityAccount): string {
    const parts: string[] = [];
    for (const family of ["gemini", "claude-gpt"] as const) {
      const remaining = this.remainingFor(account, family);
      if (remaining !== null) {
        parts.push(`${MODEL_FAMILY_LABEL[family]} ${Math.round(remaining)}%`);
      }
    }
    return parts.join(" · ");
  }

  accountOptionLabel(account: AntigravityAccount): string {
    const quota = this.summarizeQuota(account);
    return quota ? `${accountDisplayName(account)} · ${quota}` : accountDisplayName(account);
  }

  /**
   * The per-agent "Account" dropdown. `value` is the concrete account the agent
   * is on once resolved, else `auto`. Quota text is whatever is cached right now.
   */
  buildAccountFeature(value: string): AgentFeatureSelect {
    const accounts = this.accounts();
    const options: AgentSelectOption[] = [
      {
        id: ACCOUNT_AUTO,
        label: "Auto (most quota left)",
        description: "Paseo picks the account with the most quota left for the model",
        isDefault: true,
      },
      ...accounts.map((account) => ({
        id: account.id,
        label: this.accountOptionLabel(account),
        description: account.email,
      })),
    ];
    if (value !== ACCOUNT_AUTO && !options.some((option) => option.id === value)) {
      options.push({ id: value, label: `${value} (not in registry)` });
    }
    return {
      type: "select",
      id: ACCOUNT_FEATURE_ID,
      label: "Account",
      description: "Google account this agent runs on",
      tooltip: "Google account (Antigravity)",
      icon: "user",
      value,
      options,
    };
  }
}

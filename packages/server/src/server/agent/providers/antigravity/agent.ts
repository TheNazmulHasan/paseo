import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentFeature,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  FetchCatalogOptions,
  ProviderCatalog,
} from "../../agent-sdk-types.js";
import { runProviderTurn } from "../provider-runner.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import {
  ACCOUNT_AUTO,
  ACCOUNT_FEATURE_ID,
  AccountPool,
  mapToAvailableModelLabel,
} from "./account-pool.js";
import { AccountRegistryReader, accountDisplayName, type AntigravityAccount } from "./accounts.js";
import {
  MODEL_FAMILY_LABEL,
  createAgyRunner,
  detectQuotaExhausted,
  looksLikeQuotaError,
  modelFamilyOf,
  type ModelFamily,
} from "./agy-probes.js";

const ANTIGRAVITY_PROVIDER = "antigravity";
const ANTIGRAVITY_BINARY = process.env.ANTIGRAVITY_COMMAND ?? "agy";
/** Key in the persistence handle's metadata: the account whose HOME owns the agy conversation. */
const PERSISTED_ACCOUNT_KEY = "antigravityAccount";

function conversationsDir(home: string): string {
  return join(home, ".gemini", "antigravity-cli", "conversations");
}

export const ANTIGRAVITY_MODE_DEFAULT = "default";
export const ANTIGRAVITY_MODE_BYPASS = "bypass";

const MODES: AgentMode[] = [
  {
    id: ANTIGRAVITY_MODE_DEFAULT,
    label: "Default",
    description: "Ask for permission before executing tools",
    icon: "ShieldAlert",
    colorTier: "moderate",
  },
  {
    id: ANTIGRAVITY_MODE_BYPASS,
    label: "Full Access",
    description: "Auto-approve all tool calls (skips permission prompts)",
    icon: "ShieldOff",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

// Fallback only: used when every `agy models` probe fails. Ids are agy LABELS on purpose,
// because agents created before the dynamic catalog stored labels as their model id.
const FALLBACK_MODEL_LABELS = [
  "Gemini 3.8 Flash (Medium)",
  "Gemini 3.8 Flash (High)",
  "Gemini 3.8 Flash (Low)",
  "Gemini 3.1 Pro (Low)",
  "Gemini 3.1 Pro (High)",
  "Claude Sonnet 5.5 (Medium)",
  "Claude Opus 5.5 (Medium)",
  "GPT-OSS 120B (Medium)",
];

const DEFAULT_MODEL = "Gemini 3.8 Flash (Medium)";

function buildModelDefinitions(labels: string[]): AgentModelDefinition[] {
  const defaultLabel = labels.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : labels[0];
  return labels.map((label) => ({
    provider: ANTIGRAVITY_PROVIDER,
    id: label,
    label,
    description: `${label} via Antigravity CLI`,
    ...(label === defaultLabel ? { isDefault: true } : {}),
  }));
}

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

function resolveModel(model: string | undefined): string {
  if (!model || model === "gemini") {
    return DEFAULT_MODEL;
  }
  return model;
}

function listConversationIds(home: string): Set<string> {
  try {
    const files = readdirSync(conversationsDir(home));
    return new Set(files.filter((f) => f.endsWith(".pb")).map((f) => f.slice(0, -3)));
  } catch {
    return new Set();
  }
}

function promptToText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

type SpawnProcess = typeof spawn;

interface AntigravityAgentSessionOptions {
  conversationId: string | null;
  /** Account whose HOME holds `conversationId`. Null while there is no conversation. */
  conversationAccountId: string | null;
  modeId: string;
  config: AgentSessionConfig;
  logger: Logger;
  pool: AccountPool;
  spawnProcess: SpawnProcess;
}

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Text of the new response only (replayed history stripped). */
  responseText: string;
  mismatchDetected: boolean;
  spawnError: string | null;
  preConversations: Set<string>;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function readAccountChoice(config: AgentSessionConfig): string {
  const raw = config.featureValues?.[ACCOUNT_FEATURE_ID];
  return typeof raw === "string" && raw.trim() ? raw.trim() : ACCOUNT_AUTO;
}

class AntigravityAgentSession implements AgentSession {
  readonly provider = ANTIGRAVITY_PROVIDER;
  readonly capabilities = CAPABILITIES;

  private _conversationId: string | null;
  private _conversationAccountId: string | null;
  /** What the user picked: `auto` or a concrete account id. */
  private _accountChoice: string;
  /** The concrete account this agent is on once known (shown in the dropdown). */
  private _resolvedAccountId: string | null;
  private _modeId: string;
  private _config: AgentSessionConfig;
  private _logger: Logger;
  private _pool: AccountPool;
  private _spawnProcess: SpawnProcess;
  private _subscribers: Set<(event: AgentStreamEvent) => void> = new Set();
  private _activeProcess: ChildProcess | null = null;
  private _activeTurnId: string | null = null;
  private _sessionId: string = randomUUID();
  /**
   * Accumulated raw stdout from all prior turns. Because `agy --conversation`
   * replays the full conversation history on every invocation, we strip this
   * prefix to extract only the new response (same technique as openab/agy-acp).
   */
  private _prevOutput: string = "";

  constructor(options: AntigravityAgentSessionOptions) {
    this._conversationId = options.conversationId;
    this._conversationAccountId = options.conversationId ? options.conversationAccountId : null;
    this._modeId = options.modeId;
    this._config = options.config;
    this._logger = options.logger;
    this._pool = options.pool;
    this._spawnProcess = options.spawnProcess;
    this._accountChoice = readAccountChoice(options.config);
    this._resolvedAccountId =
      this._accountChoice === ACCOUNT_AUTO ? this._conversationAccountId : this._accountChoice;
  }

  get id(): string | null {
    return this._conversationId;
  }

  get features(): AgentFeature[] {
    return accountFeatures(this._pool, this.accountFeatureValue());
  }

  private accountFeatureValue(): string {
    return this._accountChoice === ACCOUNT_AUTO
      ? (this._resolvedAccountId ?? ACCOUNT_AUTO)
      : this._accountChoice;
  }

  private emit(event: AgentStreamEvent): void {
    for (const sub of this._subscribers) {
      sub(event);
    }
  }

  private emitNote(turnId: string, message: string): void {
    this.emit({
      type: "timeline",
      item: { type: "notification", level: "info", message },
      provider: ANTIGRAVITY_PROVIDER,
      turnId,
      timestamp: new Date().toISOString(),
    });
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    // No history retrieval support for agy
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    this._activeTurnId = turnId;
    this.emit({ type: "turn_started", provider: ANTIGRAVITY_PROVIDER, turnId });
    // Picking an account can probe agy (seconds), so the turn runs after we return.
    void this.executeTurn(turnId, promptToText(prompt)).catch((err: unknown) => {
      if (this._activeTurnId !== turnId) {
        return;
      }
      this._activeProcess = null;
      this._logger.error({ err }, "antigravity: turn failed before completion");
      this.emit({
        type: "turn_failed",
        provider: ANTIGRAVITY_PROVIDER,
        error: err instanceof Error ? err.message : String(err),
        turnId,
      });
    });
    return { turnId };
  }

  /** The model Paseo asked for (a label). May be retired; see `modelFlagFor`. */
  private requestedModel(): string {
    return resolveModel(this._config.model);
  }

  /**
   * The label to pass as `--model` for this account. Retired labels map to the
   * closest current one (agy would swap them silently via settings.json, but
   * `--model` does not). Null means "unknown to agy": omit the flag and let agy
   * use its own default rather than fail the turn.
   */
  private modelFlagFor(account: AntigravityAccount): string | null {
    const requested = this.requestedModel();
    const own = this._pool.modelsFor(account);
    const labels = (own ?? this._pool.cachedModelUnion() ?? []).map((model) => model.label);
    if (labels.length === 0) {
      return requested;
    }
    const mapped = mapToAvailableModelLabel(requested, labels);
    if (mapped === null && own) {
      // The account's own list is known and has nothing close: say so instead of
      // letting agy fall back to some other model without telling anyone.
      throw new Error(
        `Antigravity account "${accountDisplayName(account)}" does not offer "${requested}". Pick another account or model.`,
      );
    }
    if (mapped !== requested) {
      this._logger.warn(
        { requested, mapped, account: account.id },
        "antigravity: requested model is not listed by agy; substituting",
      );
    }
    return mapped;
  }

  private async resolveAccount(exclude: ReadonlySet<string>): Promise<AntigravityAccount | null> {
    if (this._accountChoice !== ACCOUNT_AUTO) {
      const pinned = this._pool.getAccount(this._accountChoice);
      if (!pinned) {
        throw new Error(
          `Antigravity account "${this._accountChoice}" is not enabled in google-accounts.json. Pick another account in the Account menu.`,
        );
      }
      return pinned;
    }
    const requested = this.requestedModel();
    const family = modelFamilyOf(requested);
    // An agent stays on its account while that account can still serve it:
    // the agy conversation lives in that account's HOME.
    if (this._conversationId && this._conversationAccountId) {
      const sticky = this._pool.getAccount(this._conversationAccountId);
      if (
        sticky &&
        !exclude.has(sticky.id) &&
        this._pool.remainingFor(sticky, family) !== 0 &&
        this._pool.cachedHasModel(sticky, requested)
      ) {
        return sticky;
      }
    }
    await this._pool.refreshModels();
    const union = this._pool.cachedModelUnion()?.map((model) => model.label) ?? [];
    const modelForPick = mapToAvailableModelLabel(requested, union) ?? requested;
    const picked = await this._pool.pick({ model: modelForPick, exclude });
    return picked?.account ?? null;
  }

  /**
   * Point the session at `account`. A different account than the conversation's
   * starts a new conversation (the old one lives in the old HOME); the timeline
   * says so. `failedFrom` is set when a quota failure caused the move.
   */
  private bindAccount(
    account: AntigravityAccount,
    turnId: string,
    failedFrom: AntigravityAccount | null,
  ) {
    const previous = this._conversationAccountId;
    const hadConversation = Boolean(this._conversationId && previous && previous !== account.id);
    if (hadConversation) {
      this._conversationId = null;
      this._conversationAccountId = null;
      this._prevOutput = "";
    }
    if (failedFrom) {
      this.emitNote(turnId, `Switched account: ${failedFrom.id} \u2192 ${account.id} (quota)`);
    } else if (hadConversation) {
      this.emitNote(
        turnId,
        `Switched account: ${previous} \u2192 ${account.id} (new conversation)`,
      );
    }
    this._resolvedAccountId = account.id;
  }

  private async executeTurn(turnId: string, text: string): Promise<void> {
    const exclude = new Set<string>();
    let failedFrom: AntigravityAccount | null = null;
    for (;;) {
      const account = await this.resolveAccount(exclude);
      if (this._activeTurnId !== turnId) {
        return;
      }
      if (!account) {
        this.failTurn(turnId, "Antigravity has no account with quota left for this model.");
        return;
      }
      this.bindAccount(account, turnId, failedFrom);
      failedFrom = null;

      const outcome = await this.runOnce({ turnId, account, text });
      if (this._activeTurnId !== turnId) {
        return;
      }
      this._activeProcess = null;

      const family = modelFamilyOf(this.requestedModel());
      const quota = outcome.spawnError
        ? { exhausted: false, resetsInMs: null }
        : detectQuotaExhausted({
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            code: outcome.code,
            responseText: outcome.responseText,
          });
      if (quota.exhausted) {
        const failed = await this.handleQuotaExhausted({
          turnId,
          account,
          family,
          resetsInMs: quota.resetsInMs,
          exclude,
        });
        if (failed === "retry") {
          failedFrom = account;
          continue;
        }
        return;
      }

      this.finishRun(turnId, account, outcome);
      return;
    }
  }

  /**
   * An account ran dry. Auto accounts retry once on the next best account;
   * pinned accounts (or no alternative) fail with the account and reset time.
   */
  private async handleQuotaExhausted(input: {
    turnId: string;
    account: AntigravityAccount;
    family: ModelFamily;
    resetsInMs: number | null;
    exclude: Set<string>;
  }): Promise<"retry" | "failed"> {
    const { turnId, account, family, exclude } = input;
    const until = this._pool.markExhausted(account, family, input.resetsInMs);
    exclude.add(account.id);
    const familyLabel = MODEL_FAMILY_LABEL[family];
    const resets = `Resets in ${formatDuration(until - Date.now())} (${new Date(until).toISOString()}).`;
    const base = `Antigravity account "${accountDisplayName(account)}" is out of ${familyLabel} quota.`;
    if (this._accountChoice !== ACCOUNT_AUTO) {
      this.failTurn(turnId, `${base} ${resets} Pick another account in the Account menu.`);
      return "failed";
    }
    if (exclude.size > 1) {
      // Already failed over once this turn: do not bounce around the pool.
      this.failTurn(turnId, `${base} ${resets} The account it switched to ran out as well.`);
      return "failed";
    }
    const next = await this._pool.pick({ model: this.requestedModel(), exclude });
    if (!next || this._pool.remainingFor(next.account, family) === 0) {
      this.failTurn(turnId, `${base} ${resets} No other account has ${familyLabel} quota left.`);
      return "failed";
    }
    return "retry";
  }

  private failTurn(turnId: string, error: string, code = "quota_exhausted"): void {
    this.emit({ type: "turn_failed", provider: ANTIGRAVITY_PROVIDER, error, code, turnId });
  }

  private finishRun(turnId: string, account: AntigravityAccount, outcome: RunOutcome): void {
    if (outcome.spawnError) {
      this.emit({
        type: "turn_failed",
        provider: ANTIGRAVITY_PROVIDER,
        error: `Failed to spawn agy: ${outcome.spawnError}`,
        turnId,
      });
      return;
    }

    if (!this._conversationId) {
      const postConversations = listConversationIds(account.home);
      const newIds = [...postConversations].filter((id) => !outcome.preConversations.has(id));
      if (newIds.length === 1) {
        this._conversationId = newIds[0]!;
        this._conversationAccountId = account.id;
      } else if (newIds.length > 1) {
        // Concurrent sessions created multiple .pb files; refuse to bind to avoid
        // associating with the wrong conversation (same guard as openab/agy-acp).
        this._logger.warn(
          { newIds },
          "antigravity: multiple new conversation files appeared; cannot determine which belongs to this session. Session continuity disabled.",
        );
      }
    }

    if (outcome.mismatchDetected) {
      // agy stdout was not append-only — delta extraction failed. Fail the
      // turn so the user gets a clear error rather than seeing replayed history.
      // Do NOT update _prevOutput: stale baseline is better than a corrupt one.
      this._logger.warn(
        "antigravity: agy stdout was not append-only; turn failed to avoid replaying prior conversation.",
      );
      this.emit({
        type: "turn_failed",
        provider: ANTIGRAVITY_PROVIDER,
        error: "agy output was not append-only; session continuity may be broken",
        turnId,
      });
      return;
    }

    // Update the accumulated-output baseline for the next turn's delta extraction.
    this._prevOutput = outcome.stdout;

    if (outcome.code === 0 || outcome.code === null) {
      this.emit({ type: "turn_completed", provider: ANTIGRAVITY_PROVIDER, turnId });
    } else {
      this.emit({
        type: "turn_failed",
        provider: ANTIGRAVITY_PROVIDER,
        error: `agy exited with code ${outcome.code}`,
        turnId,
      });
    }
  }

  /** Spawn agy once in the account's HOME and stream the new part of its output. */
  private runOnce(input: {
    turnId: string;
    account: AntigravityAccount;
    text: string;
  }): Promise<RunOutcome> {
    const { turnId, account, text } = input;
    const args: string[] = [];
    if (this._conversationId) {
      args.push("--conversation", this._conversationId);
    }
    const modelFlag = this.modelFlagFor(account);
    if (modelFlag) {
      args.push("--model", modelFlag);
    }
    if (this._modeId === ANTIGRAVITY_MODE_BYPASS) {
      args.push("--dangerously-skip-permissions");
      if (this._config.cwd) {
        args.push("--add-dir", this._config.cwd);
      }
    }
    args.push("--print", text);

    // Snapshot existing conversations to detect the newly created one.
    const preConversations = listConversationIds(account.home);
    const prevOutput = this._prevOutput;

    return new Promise<RunOutcome>((resolve) => {
      // HOME picks the Google account: agy keeps its login under $HOME/.gemini.
      const proc = this._spawnProcess(ANTIGRAVITY_BINARY, args, {
        cwd: this._config.cwd,
        env: { ...process.env, HOME: account.home },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this._activeProcess = proc;

      // Keep the tail of stderr: it also drains the pipe (64 KB on Linux) and is
      // where agy prints quota errors.
      let stderrTail = "";
      proc.stderr?.on("data", (chunk: Buffer | string) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-16_384);
      });

      let fullOutput = "";
      let deltaText = "";
      let mismatchDetected = false;
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

      rl.on("line", (line) => {
        if (this._activeTurnId !== turnId) {
          return;
        }
        fullOutput += `${line}\n`;
        // While still buffering the prior-turn replay, don't emit anything.
        if (fullOutput.length < prevOutput.length) {
          return;
        }
        // Once we have enough output to compare, check the prefix.
        if (!fullOutput.startsWith(prevOutput)) {
          // agy output is not append-only — suppress streaming to avoid
          // broadcasting the full conversation history as the new response.
          mismatchDetected = true;
          return;
        }
        // Strip the replayed prior turns so only the new response is shown.
        const candidate = fullOutput.slice(prevOutput.length).trimStart();
        if (candidate === deltaText) {
          return;
        }
        deltaText = candidate;
        // A quota error is not an answer: keep it out of the timeline so a failover
        // retry does not leave "Individual quota reached" behind as the reply.
        if (looksLikeQuotaError(deltaText)) {
          return;
        }
        this.emit({
          type: "timeline",
          item: { type: "assistant_message", text: deltaText },
          provider: ANTIGRAVITY_PROVIDER,
          turnId,
          timestamp: new Date().toISOString(),
        });
      });

      proc.on("close", (code) => {
        resolve({
          code,
          stdout: fullOutput,
          stderr: stderrTail,
          responseText: deltaText,
          mismatchDetected,
          spawnError: null,
          preConversations,
        });
      });

      proc.on("error", (err) => {
        resolve({
          code: null,
          stdout: fullOutput,
          stderr: stderrTail,
          responseText: deltaText,
          mismatchDetected,
          spawnError: err.message,
          preConversations,
        });
      });
    });
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, opts) => this.startTurn(p, opts),
      subscribe: (cb) => this.subscribe(cb),
      getSessionId: () => this._conversationId ?? this._sessionId,
    });
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: ANTIGRAVITY_PROVIDER,
      sessionId: this._conversationId,
      model: resolveModel(this._config.model),
      modeId: this._modeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return MODES;
  }

  async getCurrentMode(): Promise<string | null> {
    return this._modeId;
  }

  async setMode(modeId: string): Promise<void> {
    this._modeId = modeId;
    this.emit({
      type: "mode_changed",
      provider: ANTIGRAVITY_PROVIDER,
      currentModeId: modeId,
      availableModes: MODES,
    });
  }

  async setModel(modelId: string | null): Promise<void> {
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;
    this._config.model = normalizedModelId ?? undefined;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<void> {}

  /**
   * Pick the Google account for this agent. Switching never moves the agy
   * conversation (it lives in the old account's HOME): the next turn starts a
   * new conversation in the new account while Paseo's own timeline carries on.
   */
  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== ACCOUNT_FEATURE_ID) {
      throw new Error(`Unknown Antigravity feature: ${featureId}`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Antigravity account must be a non-empty string");
    }
    const choice = value.trim();
    if (choice !== ACCOUNT_AUTO && !this._pool.getAccount(choice)) {
      throw new Error(`Antigravity account "${choice}" is not enabled in google-accounts.json`);
    }
    this._accountChoice = choice;
    this._config.featureValues = { ...this._config.featureValues, [ACCOUNT_FEATURE_ID]: choice };
    if (choice !== ACCOUNT_AUTO) {
      this._resolvedAccountId = choice;
    }
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (!this._conversationId) {
      return null;
    }
    return {
      provider: ANTIGRAVITY_PROVIDER,
      sessionId: this._sessionId,
      nativeHandle: this._conversationId,
      // The handle (not featureValues) is what resume trusts for "which HOME holds this conversation".
      ...(this._conversationAccountId
        ? { metadata: { [PERSISTED_ACCOUNT_KEY]: this._conversationAccountId } }
        : {}),
    };
  }

  async interrupt(): Promise<void> {
    if (this._activeProcess) {
      this._activeProcess.kill("SIGINT");
      return;
    }
    if (this._activeTurnId) {
      // Interrupted while still picking an account: nothing is running yet.
      const turnId = this._activeTurnId;
      this._activeTurnId = null;
      this.emit({
        type: "turn_canceled",
        provider: ANTIGRAVITY_PROVIDER,
        reason: "interrupted",
        turnId,
      });
    }
  }

  async close(): Promise<void> {
    if (this._activeProcess) {
      this._activeProcess.kill();
    }
    this._subscribers.clear();
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return [
      {
        name: "explain",
        description: "Explain code or active context",
        argumentHint: "[code/topic]",
      },
      {
        name: "usage",
        description: "Show model quota and usage status",
        argumentHint: "",
      },
      {
        name: "config",
        description: "Show active agent settings",
        argumentHint: "",
      },
      {
        name: "permissions",
        description: "Manage tool execution permission rules",
        argumentHint: "",
      },
    ];
  }
}

interface AntigravityAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  /** Test seams. Production builds both from the registry file and `agy`. */
  accountPool?: AccountPool;
  spawnProcess?: SpawnProcess;
}

/**
 * The Account dropdown only appears when there is a choice to make: one account
 * (or no registry file) behaves exactly like the single-login provider did.
 */
function accountFeatures(pool: AccountPool, value: string): AgentFeature[] {
  const accounts = pool.accounts();
  const onlyAccount = accounts.length === 1 ? accounts[0]!.id : null;
  if (accounts.length <= 1 && (value === ACCOUNT_AUTO || value === onlyAccount)) {
    return [];
  }
  return [pool.buildAccountFeature(value)];
}

export class AntigravityAgentClient implements AgentClient {
  readonly provider = ANTIGRAVITY_PROVIDER;
  readonly capabilities = CAPABILITIES;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly pool: AccountPool;
  private readonly spawnProcess: SpawnProcess;

  constructor(options: AntigravityAgentClientOptions) {
    this.logger = options.logger;
    this.runtimeSettings = options.runtimeSettings;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.pool =
      options.accountPool ??
      new AccountPool({
        registry: new AccountRegistryReader({ logger: options.logger }),
        runner: createAgyRunner(ANTIGRAVITY_BINARY),
        logger: options.logger,
      });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const launch = await resolveProviderLaunch({
        commandConfig: this.runtimeSettings?.command,
        defaultBinary: ANTIGRAVITY_BINARY,
      });
      const availability = await checkProviderLaunchAvailable(launch);
      return availability.available;
    } catch {
      return false;
    }
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        diagnostic: `Antigravity: '${ANTIGRAVITY_BINARY}' binary not found. Install the Antigravity CLI and sign in with your Google account (run 'agy models' to verify).`,
      };
    }
    const accounts = this.pool.accounts();
    return {
      diagnostic: `Antigravity: '${ANTIGRAVITY_BINARY}' binary found and ready. Accounts: ${accounts.map((account) => account.id).join(", ")}.`,
    };
  }

  /** Adding an account to google-accounts.json changes this key, so the catalogue refetches. */
  async getCatalogCacheKey(_options: FetchCatalogOptions): Promise<string> {
    const accounts = this.pool.accounts();
    return `antigravity:${accounts.map((account) => `${account.id}@${account.home}`).join(",")}`;
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    // Warm the quota cache so the composer's Account menu has numbers when it opens.
    void this.pool.refreshUsage();
    const union = await this.pool.listModelUnion();
    const labels = union?.map((model) => model.label) ?? FALLBACK_MODEL_LABELS;
    return { models: buildModelDefinitions(labels), modes: MODES };
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const refresh = this.pool.refreshUsage();
    if (!this.pool.hasAnyUsage()) {
      // First open: give the probes a few seconds, then show the menu without numbers.
      await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, 4_000))]);
    }
    return accountFeatures(this.pool, readAccountChoice(config));
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new AntigravityAgentSession({
      conversationId: null,
      conversationAccountId: null,
      modeId: config.modeId ?? ANTIGRAVITY_MODE_DEFAULT,
      config,
      logger: this.logger,
      pool: this.pool,
      spawnProcess: this.spawnProcess,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const baseConfig: AgentSessionConfig = {
      provider: ANTIGRAVITY_PROVIDER,
      cwd: overrides?.cwd ?? homedir(),
      ...overrides,
    };
    // Conversations made before the registry existed live in the real home: main.
    const storedAccount = handle.metadata?.[PERSISTED_ACCOUNT_KEY];
    const conversationAccountId =
      typeof storedAccount === "string" && storedAccount
        ? storedAccount
        : (this.pool.mainAccount()?.id ?? null);
    return new AntigravityAgentSession({
      conversationId: handle.nativeHandle ?? null,
      conversationAccountId,
      modeId: baseConfig.modeId ?? ANTIGRAVITY_MODE_DEFAULT,
      config: baseConfig,
      logger: this.logger,
      pool: this.pool,
      spawnProcess: this.spawnProcess,
    });
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return [
      {
        name: "explain",
        description: "Explain code or active context",
        argumentHint: "[code/topic]",
      },
      {
        name: "usage",
        description: "Show model quota and usage status",
        argumentHint: "",
      },
      {
        name: "config",
        description: "Show active agent settings",
        argumentHint: "",
      },
      {
        name: "permissions",
        description: "Manage tool execution permission rules",
        argumentHint: "",
      },
    ];
  }
}

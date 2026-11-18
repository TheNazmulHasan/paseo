import type { Logger } from "pino";
import type { HomeCard, TopicTrail } from "@getpaseo/protocol/topic-trail";
import type { AgentManager, AgentManagerEvent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  generateStructuredAgentResponseWithFallback,
  type StructuredGenerationProvider,
} from "../agent-response-loop.js";
import { mergeTopicTrail } from "./merge-topic-trail.js";
import {
  cardIsCurrent,
  dropKeepAliveRows,
  mergeHomeCard,
  newestMessageSeq,
} from "./home-card.js"; // Nazmul mod (home-map)
import { AUTO_TITLE_ENV, pickAutoRename } from "./auto-title.js"; // Nazmul mod (home-map)
import {
  MAX_USER_MESSAGES,
  TopicTrailModelSchema,
  buildTopicTrailPrompt,
} from "./topic-trail-prompt.js";

/**
 * Nazmul mod (topic-trail): after each finished turn (and once for old sessions that have no
 * trail yet) ask a small model for the session's last 3 topics and a "your move" line, then
 * store them on the agent record. Runs one job at a time, never throws.
 *
 * PRIVACY: conversation text is sent ONLY to the providers hard-coded in
 * `resolveTopicTrailProviders` (Antigravity, then Claude Haiku). Never swap in
 * resolveStructuredGenerationProviders: its defaults include proxied routes.
 */

export const TOPIC_TRAIL_ENV = "PASEO_TOPIC_TRAIL";
/** Nazmul mod (home-map): PASEO_HOME_CARD=0 keeps the trail but stops writing session cards. */
export const HOME_CARD_ENV = "PASEO_HOME_CARD";
/** Nazmul mod (home-map): PASEO_HOME_BACKFILL=0 stops the once-per-run card backfill. */
export const HOME_BACKFILL_ENV = "PASEO_HOME_BACKFILL";
const DEBOUNCE_MS = 3000;
const BACKFILL_DELAY_MS = 20_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ManagerPort = Pick<
  AgentManager,
  "subscribe" | "getAgent" | "getTimelineRows" | "fetchTimeline" | "setTopicTrail"
>;

export interface TopicTrailServiceOptions {
  agentManager: ManagerPort;
  agentStorage: Pick<AgentStorage, "get"> & Partial<Pick<AgentStorage, "list">>;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  logger: Pick<Logger, "info" | "warn" | "debug">;
  /** Test seams. */
  generate?: typeof generateStructuredAgentResponseWithFallback;
  debounceMs?: number;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /**
   * Nazmul mod (home-map). Loads a stored agent so its timeline can be read (the backfill of
   * sessions that have no card yet). Without it only already-loaded agents are backfilled.
   */
  loadAgent?: (agentId: string) => Promise<unknown>;
  /** Nazmul mod (home-map): closes a session the backfill loaded, so ~60 old chats do not stay in memory. */
  unloadAgent?: (agentId: string) => Promise<unknown>;
  /** Workspace and folder names for the card prompt. */
  describeSession?: (agentId: string) => Promise<{ workspace: string | null; folder: string | null }>;
  /** The text of `~/.paseo/home-priorities.md`, when present. Read on every card. */
  readPriorities?: () => string | null;
  /**
   * Renames a session the way the tab rename does, without counting as activity. Only called when
   * its title is still the automatic one (see auto-title.ts). Absent = no renaming.
   */
  setAutoTitle?: (agentId: string, title: string) => Promise<void>;
  /** A card was written or changed: Home's brief listens. */
  onCardChanged?: (agentId: string, card: HomeCard) => void;
  backfillDelayMs?: number;
}

export async function resolveTopicTrailProviders(
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">,
  cwd: string,
): Promise<StructuredGenerationProvider[]> {
  const providers: StructuredGenerationProvider[] = [{ provider: "antigravity" }];
  try {
    const entries = await providerSnapshotManager.listProviders({
      cwd,
      providers: ["claude"],
      wait: true,
    });
    const claude = entries.find((entry) => entry.provider === "claude" && entry.enabled);
    const haiku = claude?.models?.find((model) => model.id.toLowerCase().includes("haiku"));
    if (haiku) {
      providers.push({ provider: "claude", model: haiku.id });
    }
  } catch {
    // Antigravity alone is fine.
  }
  return providers;
}

export class TopicTrailService {
  private readonly attemptedBackfill = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queue: string[] = [];
  private draining = false;
  private unsubscribe: (() => void) | null = null;
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;
  private backfillStarted = false;
  private disposed = false;

  constructor(private readonly options: TopicTrailServiceOptions) {}

  static isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[TOPIC_TRAIL_ENV] !== "0";
  }

  private cardsEnabled(): boolean {
    return (this.options.env ?? process.env)[HOME_CARD_ENV] !== "0";
  }

  start(): void {
    if (this.unsubscribe || !TopicTrailService.isEnabled(this.options.env)) {
      return;
    }
    this.unsubscribe = this.options.agentManager.subscribe((event) => this.onEvent(event), {
      replayState: false,
    });
    // Nazmul mod (home-map): once per daemon run, give every open session without a card one.
    const env = this.options.env ?? process.env;
    if (this.options.loadAgent && this.cardsEnabled() && env[HOME_BACKFILL_ENV] !== "0") {
      this.backfillTimer = setTimeout(
        () => void this.backfillCards(),
        this.options.backfillDelayMs ?? BACKFILL_DELAY_MS,
      );
    }
  }

  /**
   * Nazmul mod (home-map): load each open session that has no card, one at a time, and read it.
   * Sequential on purpose: a model call per session, never a burst. Safe to call twice.
   */
  async backfillCards(): Promise<void> {
    const { agentStorage, loadAgent } = this.options;
    if (this.backfillStarted || this.disposed || !loadAgent || !agentStorage.list) return;
    this.backfillStarted = true;
    try {
      const records = await agentStorage.list();
      const missing = records
        .filter((record) => !record.archivedAt && !record.internal && !record.topicTrail?.card)
        .sort((a, b) => Date.parse(b.lastActivityAt ?? b.updatedAt) - Date.parse(a.lastActivityAt ?? a.updatedAt));
      for (const record of missing) {
        if (this.disposed) return;
        try {
          this.attemptedBackfill.add(record.id);
          const wasLoaded = this.options.agentManager.getAgent(record.id) !== undefined;
          await loadAgent(record.id);
          try {
            await this.update(record.id);
          } finally {
            if (!wasLoaded) await this.options.unloadAgent?.(record.id);
          }
        } catch (error) {
          this.options.logger.debug({ err: error, agentId: record.id }, "home-card: backfill skipped");
        }
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "home-card: backfill failed");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queue.length = 0;
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
    this.backfillTimer = null;
  }

  /** Resolves once every queued job has finished (tests). */
  async idle(): Promise<void> {
    while (this.draining || this.queue.length > 0 || this.timers.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private onEvent(event: AgentManagerEvent): void {
    try {
      if (event.type === "agent_stream") {
        // Our own helper agents are internal: ignoring them is what stops a recursion.
        if (
          event.event.type === "turn_completed" &&
          this.options.agentManager.getAgent(event.agentId)?.internal !== true
        ) {
          this.schedule(event.agentId);
        }
        return;
      }
      if (event.type === "agent_state") {
        this.maybeBackfill(event.agent);
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "topic-trail: event handler failed");
    }
  }

  /** An old session was loaded and has no trail yet: try once per daemon run. */
  private maybeBackfill(agent: { id: string; internal?: boolean; lifecycle: string }): void {
    if (agent.internal || agent.lifecycle !== "idle" || this.attemptedBackfill.has(agent.id)) {
      return;
    }
    this.attemptedBackfill.add(agent.id);
    void this.scheduleIfNoTrail(agent.id);
  }

  private async scheduleIfNoTrail(agentId: string): Promise<void> {
    try {
      const record = await this.options.agentStorage.get(agentId);
      // Nazmul mod (home-map): a trail without a card is still missing its card.
      if (!record?.topicTrail?.card && !record?.internal) {
        this.schedule(agentId);
      }
    } catch {
      // best effort
    }
  }

  private schedule(agentId: string): void {
    if (this.disposed) {
      return;
    }
    const existing = this.timers.get(agentId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.timers.delete(agentId);
      if (!this.queue.includes(agentId)) {
        this.queue.push(agentId);
      }
      void this.drain();
    }, this.options.debounceMs ?? DEBOUNCE_MS);
    this.timers.set(agentId, timer);
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      for (let agentId = this.queue.shift(); agentId; agentId = this.queue.shift()) {
        try {
          await this.update(agentId);
        } catch (error) {
          this.options.logger.warn({ err: error, agentId }, "topic-trail: update failed");
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async update(agentId: string): Promise<void> {
    const { agentManager, agentStorage, providerSnapshotManager, logger } = this.options;
    const agent = agentManager.getAgent(agentId);
    if (!agent || agent.internal) {
      return;
    }

    // Nazmul mod (home-map): cache-warm pings are not conversation; drop them before anything reads rows.
    const rows = dropKeepAliveRows(await agentManager.getTimelineRows(agentId));
    const userRows = rows.filter(
      (row) => row.item.type === "user_message" && row.item.text.trim().length > 0,
    );
    const newestUserSeq = userRows.at(-1)?.seq;
    if (newestUserSeq === undefined) {
      return;
    }
    const previous = (await agentStorage.get(agentId))?.topicTrail ?? null;
    const withCard = this.cardsEnabled();
    const newestSeq = newestMessageSeq(rows);
    // Never re-read an unchanged session: nothing newer than what the trail and the card were read from.
    if (
      previous &&
      newestUserSeq <= previous.basedOnSeq &&
      (!withCard || cardIsCurrent(previous.card, newestSeq))
    ) {
      return;
    }

    const window = userRows.slice(-MAX_USER_MESSAGES);
    const lastAssistant = rows.findLast((row) => row.item.type === "assistant_message");
    const now = (this.options.now ?? (() => new Date()))();
    const prompt = buildTopicTrailPrompt({
      userMessages: window.map((row) => ({
        seq: row.seq,
        text: row.item.type === "user_message" ? row.item.text : "",
      })),
      finalReply: lastAssistant?.item.type === "assistant_message" ? lastAssistant.item.text : null,
      previousLabels: previous?.topics.map((topic) => topic.label) ?? [],
      card: withCard
        ? await this.cardContext({ agentId, agent, rows, previous: previous?.card ?? null, now })
        : undefined,
    });

    const generate = this.options.generate ?? generateStructuredAgentResponseWithFallback;
    const result = await generate({
      manager: agentManager as unknown as AgentManager,
      cwd: agent.cwd,
      prompt,
      schema: TopicTrailModelSchema,
      schemaName: "TopicTrail",
      providers: await resolveTopicTrailProviders(providerSnapshotManager, agent.cwd),
      persistSession: false,
      maxRetries: 1,
      logger,
      agentConfigOverrides: { title: "Topic trail", internal: true },
    });

    let epoch: string | null = null;
    try {
      epoch = agentManager.fetchTimeline(agentId, { direction: "tail", limit: 1 }).epoch;
    } catch {
      // seq alone still lets the client try the jump
    }
    const trail: TopicTrail = mergeTopicTrail(
      previous,
      result,
      new Map(window.map((row) => [row.seq, { timestamp: row.timestamp }])),
      epoch,
      now,
    );
    // Nazmul mod (home-map): a new card, else the old one stays (a card-less answer must not wipe it).
    const modelCard = withCard ? result.card : undefined;
    let card = modelCard
      ? mergeHomeCard(previous?.card, modelCard, newestSeq, now)
      : (previous?.card ?? null);
    if (card && modelCard) {
      card = await this.applyAutoTitle(agentId, card, userRows[0]?.item, now);
    }
    const stored: TopicTrail = card ? { ...trail, card } : trail;
    await agentManager.setTopicTrail(agentId, stored);
    if (card && modelCard) {
      try {
        this.options.onCardChanged?.(agentId, card);
      } catch (error) {
        logger.warn({ err: error, agentId }, "home-card: change listener failed");
      }
    }
  }

  /**
   * Nazmul mod (home-map): rename the session to the card's theme, once, and only while its title
   * is still the automatic one. Returns the card with `renamed` recorded when it happened.
   */
  private async applyAutoTitle(
    agentId: string,
    card: HomeCard,
    firstUserItem: { type: string; text?: string } | undefined,
    now: Date,
  ): Promise<HomeCard> {
    const { agentStorage, logger, setAutoTitle } = this.options;
    const env = this.options.env ?? process.env;
    if (!setAutoTitle || env[AUTO_TITLE_ENV] === "0") return card;
    try {
      const record = await agentStorage.get(agentId);
      const rename = pickAutoRename({
        enabled: true,
        card,
        currentTitle: record?.title,
        firstUserMessage: firstUserItem?.type === "user_message" ? (firstUserItem.text ?? null) : null,
        agentId,
      });
      if (!rename) return card;
      await setAutoTitle(agentId, rename.to);
      return { ...card, renamed: { from: rename.from, to: rename.to, at: now.toISOString() } };
    } catch (error) {
      logger.warn({ err: error, agentId }, "home-card: auto title failed");
      return card;
    }
  }

  /** Nazmul mod (home-map): the facts the card prompt needs beyond the trail's own input. */
  private async cardContext(input: {
    agentId: string;
    agent: { lifecycle: string };
    rows: readonly { seq: number; timestamp: string; item: { type: string; text?: string } }[];
    previous: HomeCard | null;
    now: Date;
  }) {
    const { agentStorage } = this.options;
    const record = await agentStorage.get(input.agentId).catch(() => null);
    const where = await this.options.describeSession?.(input.agentId).catch(() => null);
    const lastMessage = input.rows.findLast(
      (row) =>
        (row.item.type === "user_message" || row.item.type === "assistant_message") &&
        (row.item.text ?? "").trim().length > 0,
    );
    const lastAt = lastMessage ? Date.parse(lastMessage.timestamp) : Number.NaN;
    return {
      title: record?.title ?? null,
      status: input.agent.lifecycle,
      workspace: where?.workspace ?? null,
      folder: where?.folder ?? null,
      lastSpeaker:
        lastMessage?.item.type === "user_message"
          ? ("user" as const)
          : lastMessage
            ? ("assistant" as const)
            : null,
      quietDays: Number.isNaN(lastAt)
        ? null
        : Math.max(0, Math.floor((input.now.getTime() - lastAt) / MS_PER_DAY)),
      previousCard: input.previous,
      priorities: this.options.readPriorities?.() ?? null,
    };
  }
}

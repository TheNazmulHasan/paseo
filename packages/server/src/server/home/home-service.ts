import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

import {
  HomeBriefSchema,
  type HomeBrief,
  type HomeLayout,
  type HomeRecentPage,
  type HomeSnapshot,
  type HomeState,
} from "@getpaseo/protocol/home";

import type { AgentManager } from "../agent/agent-manager.js";
import {
  generateStructuredAgentResponseWithFallback,
  type StructuredGenerationProvider,
} from "../agent/agent-response-loop.js";
import { writeFileAtomic } from "../atomic-file.js";
import {
  HomeBriefModelSchema,
  briefCandidates,
  briefInputKey,
  buildBriefPrompt,
  emptyBrief,
  sanitizeBrief,
  type BriefCard,
} from "./home-brief.js";
import { HomeStateStore } from "./home-state.js";

/**
 * Nazmul mod (home-map): the daemon side of Home. Owns the brief (one small model call over all
 * open cards), the state file, and the pushes. Writes a new brief when cards change (debounced,
 * at most every 10 minutes) and on demand.
 *
 * PRIVACY: card text goes ONLY to the providers the topic trail uses (`resolveProviders`, injected
 * from `resolveTopicTrailProviders`: Antigravity, then Claude Haiku). Never swap in
 * the general structured-generation provider list: its defaults include proxied routes.
 */

export const HOME_BRIEF_ENV = "PASEO_HOME_BRIEF";
const DEBOUNCE_MS = 30_000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;

export interface HomeServiceOptions {
  paseoHome: string;
  /** Every open (not archived, not internal) session that has a card. */
  listCards: () => Promise<BriefCard[]>;
  /** Sessions archived since local midnight. */
  countClosedToday: () => Promise<number>;
  /** Closed (archived) sessions he wrote to, newest first: one page. */
  listRecentClosed?: (offset: number, limit: number) => Promise<HomeRecentPage>;
  manager: Pick<AgentManager, "getProviderAvailability"> & Record<string, unknown>;
  resolveProviders: (cwd: string) => Promise<StructuredGenerationProvider[]>;
  logger: Pick<Logger, "info" | "warn" | "debug">;
  readPriorities?: () => string | null;
  /** Test seams. */
  generate?: typeof generateStructuredAgentResponseWithFallback;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  debounceMs?: number;
  minIntervalMs?: number;
  startupDelayMs?: number;
}

export type HomeSnapshotListener = (snapshot: HomeSnapshot) => void;

export class HomeService {
  private readonly store: HomeStateStore;
  private readonly briefPath: string;
  private brief: HomeBrief | null = null;
  private running: Promise<void> | null = null;
  private lastRunAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<HomeSnapshotListener>();
  private disposed = false;

  constructor(private readonly options: HomeServiceOptions) {
    this.store = new HomeStateStore(HomeStateStore.pathFor(options.paseoHome), () =>
      this.now().getTime(),
    );
    this.briefPath = path.join(options.paseoHome, "home", "brief.json");
  }

  static isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[HOME_BRIEF_ENV] !== "0";
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private enabled(): boolean {
    return HomeService.isEnabled(this.options.env);
  }

  /** Loads the cached brief and state, and writes a first brief shortly after boot when it is stale. */
  async start(): Promise<void> {
    await this.store.load();
    try {
      const parsed = HomeBriefSchema.safeParse(
        JSON.parse(await fs.readFile(this.briefPath, "utf8")) as unknown,
      );
      if (parsed.success) this.brief = parsed.data;
    } catch {
      // no brief yet
    }
    if (!this.enabled()) return;
    const stale =
      !this.brief ||
      this.now().getTime() - Date.parse(this.brief.generatedAt) > (this.options.minIntervalMs ?? MIN_INTERVAL_MS);
    if (stale) {
      this.startupTimer = setTimeout(
        () => void this.runBrief(false),
        this.options.startupDelayMs ?? STARTUP_DELAY_MS,
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
    this.listeners.clear();
  }

  /** Resolves once no brief is being written (tests, and `refresh` callers that joined a run). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  subscribe(listener: HomeSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSnapshot(): Promise<HomeSnapshot> {
    return {
      brief: this.brief,
      state: this.store.get(),
      closedToday: await this.options.countClosedToday().catch(() => 0),
      briefRunning: this.running !== null,
      updatedAt: this.now().toISOString(),
    };
  }

  /** "Recently worked on", past the open sessions: closed ones, newest first. */
  async recentClosed(offset: number, limit: number): Promise<HomeRecentPage> {
    if (!this.options.listRecentClosed) return { items: [], hasMore: false };
    return this.options.listRecentClosed(offset, limit);
  }

  /** A card was written or changed. Debounced, and never more often than every 10 minutes. */
  noteCardsChanged(): void {
    if (this.disposed || !this.enabled()) return;
    if (this.timer) clearTimeout(this.timer);
    const minInterval = this.options.minIntervalMs ?? MIN_INTERVAL_MS;
    const sinceLast = this.now().getTime() - this.lastRunAt;
    const wait = Math.max(this.options.debounceMs ?? DEBOUNCE_MS, minInterval - sinceLast);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runBrief(false);
    }, wait);
  }

  /**
   * Forces a new brief. With `wait`, resolves when it is written; without, returns at once with
   * `briefRunning: true` and the push follows (an RPC must not hold a socket for a model call).
   */
  async refresh(options: { wait: boolean }): Promise<HomeSnapshot> {
    if (!this.enabled()) return this.getSnapshot();
    const run = this.runBrief(true);
    if (options.wait) await run;
    return this.getSnapshot();
  }

  async snooze(agentId: string, until: string | null): Promise<HomeSnapshot> {
    await this.store.snooze(agentId, until);
    return this.publish();
  }

  async keep(agentId: string, keep: boolean): Promise<HomeSnapshot> {
    await this.store.keep(agentId, keep);
    return this.publish();
  }

  async setLayout(layout: HomeLayout | null): Promise<HomeSnapshot> {
    await this.store.setLayout(layout);
    return this.publish();
  }

  getState(): HomeState {
    return this.store.get();
  }

  private async publish(): Promise<HomeSnapshot> {
    const snapshot = await this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.options.logger.warn({ err: error }, "home: listener failed");
      }
    }
    return snapshot;
  }

  /** Single flight: a second call while one runs joins it. A non-forced run is skipped when nothing changed. */
  private runBrief(force: boolean): Promise<void> {
    if (this.running) return this.running;
    const run = this.writeBrief(force)
      .catch((error: unknown) => {
        this.options.logger.warn({ err: error }, "home: brief failed");
      })
      .finally(() => {
        this.running = null;
        this.lastRunAt = this.now().getTime();
        void this.publish();
      });
    this.running = run;
    void this.publish();
    return run;
  }

  private async writeBrief(force: boolean): Promise<void> {
    if (this.disposed) return;
    const { logger } = this.options;
    const cards = await this.options.listCards();
    const now = this.now();
    const priorities = this.options.readPriorities?.() ?? null;
    const key = briefInputKey(cards, priorities);
    if (!force && this.brief?.inputKey === key) {
      logger.debug("home: brief inputs unchanged, skipped");
      return;
    }
    if (briefCandidates(cards).length === 0) {
      await this.save(emptyBrief(now, key));
      return;
    }
    const generate = this.options.generate ?? generateStructuredAgentResponseWithFallback;
    const result = await generate({
      manager: this.options.manager as unknown as AgentManager,
      cwd: this.options.paseoHome,
      prompt: buildBriefPrompt({ cards, priorities, now }),
      schema: HomeBriefModelSchema,
      schemaName: "HomeBrief",
      providers: await this.options.resolveProviders(this.options.paseoHome),
      persistSession: false,
      maxRetries: 1,
      logger,
      agentConfigOverrides: { title: "Home brief", internal: true },
    });
    await this.save(sanitizeBrief(result, cards, now, key));
  }

  private async save(brief: HomeBrief): Promise<void> {
    this.brief = brief;
    await writeFileAtomic(this.briefPath, JSON.stringify(brief, null, 2));
  }
}

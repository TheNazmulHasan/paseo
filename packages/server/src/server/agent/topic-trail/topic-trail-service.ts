import type { Logger } from "pino";
import type { TopicTrail } from "@getpaseo/protocol/topic-trail";
import type { AgentManager, AgentManagerEvent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  generateStructuredAgentResponseWithFallback,
  type StructuredGenerationProvider,
} from "../agent-response-loop.js";
import { mergeTopicTrail } from "./merge-topic-trail.js";
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
const DEBOUNCE_MS = 3000;

type ManagerPort = Pick<
  AgentManager,
  "subscribe" | "getAgent" | "getTimelineRows" | "fetchTimeline" | "setTopicTrail"
>;

export interface TopicTrailServiceOptions {
  agentManager: ManagerPort;
  agentStorage: Pick<AgentStorage, "get">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  logger: Pick<Logger, "info" | "warn" | "debug">;
  /** Test seams. */
  generate?: typeof generateStructuredAgentResponseWithFallback;
  debounceMs?: number;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
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
  private disposed = false;

  constructor(private readonly options: TopicTrailServiceOptions) {}

  static isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[TOPIC_TRAIL_ENV] !== "0";
  }

  start(): void {
    if (this.unsubscribe || !TopicTrailService.isEnabled(this.options.env)) {
      return;
    }
    this.unsubscribe = this.options.agentManager.subscribe((event) => this.onEvent(event), {
      replayState: false,
    });
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
      if (!record?.topicTrail && !record?.internal) {
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

    const rows = await agentManager.getTimelineRows(agentId);
    const userRows = rows.filter(
      (row) => row.item.type === "user_message" && row.item.text.trim().length > 0,
    );
    const newestUserSeq = userRows.at(-1)?.seq;
    if (newestUserSeq === undefined) {
      return;
    }
    const previous = (await agentStorage.get(agentId))?.topicTrail ?? null;
    if (previous && newestUserSeq <= previous.basedOnSeq) {
      return;
    }

    const window = userRows.slice(-MAX_USER_MESSAGES);
    const lastAssistant = rows.findLast((row) => row.item.type === "assistant_message");
    const prompt = buildTopicTrailPrompt({
      userMessages: window.map((row) => ({
        seq: row.seq,
        text: row.item.type === "user_message" ? row.item.text : "",
      })),
      finalReply: lastAssistant?.item.type === "assistant_message" ? lastAssistant.item.text : null,
      previousLabels: previous?.topics.map((topic) => topic.label) ?? [],
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
      (this.options.now ?? (() => new Date()))(),
    );
    await agentManager.setTopicTrail(agentId, trail);
  }
}

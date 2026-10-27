import { describe, expect, it, vi } from "vitest";
import type { TopicTrail } from "@getpaseo/protocol/topic-trail";
import type { AgentManagerEvent } from "../agent-manager.js";
import { TopicTrailService, resolveTopicTrailProviders } from "./topic-trail-service.js";

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

function setup(
  options: { internal?: boolean; stored?: TopicTrail | null; env?: NodeJS.ProcessEnv } = {},
) {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;
  const agent = { id: "a1", cwd: "/work", internal: options.internal ?? false, lifecycle: "idle" };
  const rows = [
    { seq: 1, timestamp: "t1", item: { type: "user_message", text: "price the meters" } },
    { seq: 2, timestamp: "t2", item: { type: "assistant_message", text: "Assign DEE-41?" } },
  ];
  const setTopicTrail = vi.fn(async () => undefined);
  const generate = vi.fn(async () => ({
    topics: [{ label: "Pricing meters", startSeq: 1 }],
    yourMove: "Assign DEE-41?",
  }));
  const service = new TopicTrailService({
    agentManager: {
      subscribe: (callback: (event: AgentManagerEvent) => void) => {
        subscriber = callback;
        return () => undefined;
      },
      getAgent: () => agent,
      getTimelineRows: async () => rows,
      fetchTimeline: () => ({ epoch: "ep" }),
      setTopicTrail,
    } as never,
    agentStorage: { get: async () => ({ topicTrail: options.stored ?? undefined }) } as never,
    providerSnapshotManager: { listProviders: async () => [] },
    logger,
    generate: generate as never,
    debounceMs: 5,
    env: options.env ?? {},
  });
  service.start();
  const emitTurn = () =>
    subscriber?.({
      type: "agent_stream",
      agentId: "a1",
      event: { type: "turn_completed", provider: "claude" },
    } as AgentManagerEvent);
  return {
    service,
    setTopicTrail,
    generate,
    emitTurn,
    emitState: () => subscriber?.({ type: "agent_state", agent: agent as never }),
  };
}

describe("TopicTrailService", () => {
  it("writes a trail after a completed turn, debounced to one run", async () => {
    const { service, setTopicTrail, generate, emitTurn } = setup();
    emitTurn();
    emitTurn();
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(setTopicTrail).toHaveBeenCalledTimes(1);
    const trail = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
    expect(trail.topics[0]).toMatchObject({ label: "Pricing meters", seq: 1, epoch: "ep" });
    expect(trail.basedOnSeq).toBe(1);
    expect(trail.yourMove).toBe("Assign DEE-41?");
  });

  it("ignores internal agents", async () => {
    const { service, generate, emitTurn } = setup({ internal: true });
    emitTurn();
    await service.idle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips when no user message is newer than the stored trail", async () => {
    const stored: TopicTrail = { topics: [], yourMove: null, basedOnSeq: 1, updatedAt: "x" };
    const { service, generate, emitTurn } = setup({ stored });
    emitTurn();
    await service.idle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("backfills a loaded session without a trail once per run", async () => {
    const { service, generate, emitState } = setup();
    emitState();
    emitState();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("is fully off with PASEO_TOPIC_TRAIL=0", async () => {
    const { service, generate, emitTurn } = setup({ env: { PASEO_TOPIC_TRAIL: "0" } });
    emitTurn();
    await service.idle();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("resolveTopicTrailProviders", () => {
  it("is Antigravity first, then Claude Haiku only, nothing else", async () => {
    const providers = await resolveTopicTrailProviders(
      {
        listProviders: async () =>
          [
            {
              provider: "claude",
              enabled: true,
              models: [{ id: "claude-opus-5" }, { id: "claude-haiku-5-5" }],
            },
          ] as never,
      },
      "/work",
    );
    expect(providers).toEqual([
      { provider: "antigravity" },
      { provider: "claude", model: "claude-haiku-5-5" },
    ]);
  });

  it("falls back to Antigravity alone when no Haiku model exists", async () => {
    const providers = await resolveTopicTrailProviders({ listProviders: async () => [] }, "/work");
    expect(providers).toEqual([{ provider: "antigravity" }]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { HomeCard, TopicTrail } from "@getpaseo/protocol/topic-trail";
import type { AgentManagerEvent } from "../agent-manager.js";
import { TopicTrailService, resolveTopicTrailProviders } from "./topic-trail-service.js";

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const MODEL_CARD = {
  title: "Meter pricing for DEE-41",
  what: "Pricing the meters",
  status: "Waiting on the DEE-41 owner.",
  waitingOn: "nazmul",
  kind: "decision" as const,
  nextStep: "Assign DEE-41",
  urgency: "today" as const,
  importance: "high" as const,
  why: "Blocks the meter work.",
  looksFinished: false,
  stopped: false,
};

function storedCard(extra: Partial<HomeCard> = {}): HomeCard {
  return {
    ...MODEL_CARD,
    openItems: [],
    basedOnSeq: 2,
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...extra,
  };
}

function setup(
  options: {
    internal?: boolean;
    stored?: TopicTrail | null;
    env?: NodeJS.ProcessEnv;
    rows?: { seq: number; timestamp: string; item: { type: string; text: string } }[];
    title?: string | null;
    autoTitle?: boolean;
    card?: boolean;
  } = {},
) {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;
  const agent = { id: "a1", cwd: "/work", internal: options.internal ?? false, lifecycle: "idle" };
  const rows = options.rows ?? [
    { seq: 1, timestamp: "2026-11-17T10:00:00.000Z", item: { type: "user_message", text: "price the meters" } },
    { seq: 2, timestamp: "2026-11-17T10:01:00.000Z", item: { type: "assistant_message", text: "Assign DEE-41?" } },
  ];
  const setTopicTrail = vi.fn(async () => undefined);
  const setAutoTitle = vi.fn(async () => undefined);
  const onCardChanged = vi.fn();
  const generate = vi.fn(async () => ({
    topics: [{ label: "Pricing meters", startSeq: 1 }],
    yourMove: "Assign DEE-41?",
    ...(options.card === false ? {} : { card: MODEL_CARD }),
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
    agentStorage: {
      get: async () => ({
        title: options.title === undefined ? "price the meters" : options.title,
        topicTrail: options.stored ?? undefined,
      }),
    } as never,
    providerSnapshotManager: { listProviders: async () => [] },
    logger,
    generate: generate as never,
    debounceMs: 5,
    env: options.env ?? {},
    now: () => new Date("2026-11-18T09:00:00.000Z"),
    onCardChanged,
    ...(options.autoTitle ? { setAutoTitle } : {}),
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
    setAutoTitle,
    onCardChanged,
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

  it("skips when no message is newer than the stored trail and card", async () => {
    const stored: TopicTrail = {
      topics: [],
      yourMove: null,
      basedOnSeq: 1,
      updatedAt: "x",
      card: storedCard({ basedOnSeq: 2 }),
    };
    const { service, generate, emitTurn } = setup({ stored });
    emitTurn();
    await service.idle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("reads a session again when the agent replied after the card was written", async () => {
    const stored: TopicTrail = {
      topics: [],
      yourMove: null,
      basedOnSeq: 1,
      updatedAt: "x",
      card: storedCard({ basedOnSeq: 1 }),
    };
    const { service, generate, emitTurn } = setup({ stored });
    emitTurn();
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("an old trail without a card still gets its card (once)", async () => {
    const stored: TopicTrail = { topics: [], yourMove: null, basedOnSeq: 1, updatedAt: "x" };
    const { service, generate, setTopicTrail, emitTurn } = setup({ stored });
    emitTurn();
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
    expect(written.card).toMatchObject({ waitingOn: "nazmul", basedOnSeq: 2, nextStep: "Assign DEE-41" });
  });

  it("writes the card with the trail in one call and tells the brief", async () => {
    const { service, setTopicTrail, generate, onCardChanged, emitTurn } = setup();
    emitTurn();
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = (generate.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("card.waitingOn");
    expect(prompt).toContain("lastSpeaker: assistant");
    const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
    expect(written.card).toMatchObject({ title: "Meter pricing for DEE-41", urgency: "today" });
    expect(onCardChanged).toHaveBeenCalledWith("a1", expect.objectContaining({ what: "Pricing the meters" }));
  });

  it("keeps the old card when the model answers without one", async () => {
    const stored: TopicTrail = {
      topics: [],
      yourMove: null,
      basedOnSeq: 0,
      updatedAt: "x",
      card: storedCard({ basedOnSeq: 0 }),
    };
    const { service, setTopicTrail, onCardChanged, emitTurn } = setup({ stored, card: false });
    emitTurn();
    await service.idle();
    const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
    expect(written.card?.what).toBe("Pricing the meters");
    expect(onCardChanged).not.toHaveBeenCalled();
  });

  it("does not count cache-warm pings as messages: a ping alone triggers no new reading", async () => {
    const rows = [
      { seq: 1, timestamp: "2026-11-17T10:00:00.000Z", item: { type: "user_message", text: "price the meters" } },
      { seq: 2, timestamp: "2026-11-17T10:01:00.000Z", item: { type: "assistant_message", text: "Assign DEE-41?" } },
      { seq: 3, timestamp: "2026-11-17T11:00:00.000Z", item: { type: "user_message", text: "AFK for a bit, keeping you alive. Reply with 'ok' only." } },
      { seq: 4, timestamp: "2026-11-17T11:00:05.000Z", item: { type: "assistant_message", text: "ok" } },
    ];
    const stored: TopicTrail = {
      topics: [],
      yourMove: null,
      basedOnSeq: 1,
      updatedAt: "x",
      card: storedCard({ basedOnSeq: 2 }),
    };
    const { service, generate, emitTurn } = setup({ stored, rows });
    emitTurn();
    await service.idle();
    expect(generate).not.toHaveBeenCalled();
  });

  it("PASEO_HOME_CARD=0 keeps the trail and writes no card", async () => {
    const { service, setTopicTrail, generate, emitTurn } = setup({ env: { PASEO_HOME_CARD: "0" } });
    emitTurn();
    await service.idle();
    const prompt = (generate.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).not.toContain("card.waitingOn");
    const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
    expect(written.card).toBeUndefined();
  });

  describe("auto title", () => {
    it("renames a session whose title is still the first words of the prompt, once", async () => {
      const { service, setAutoTitle, setTopicTrail, emitTurn } = setup({ autoTitle: true });
      emitTurn();
      await service.idle();
      expect(setAutoTitle).toHaveBeenCalledWith("a1", "Meter pricing for DEE-41");
      const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
      expect(written.card?.renamed).toMatchObject({ from: "price the meters", to: "Meter pricing for DEE-41" });
    });

    it("leaves a title a person or an agent set", async () => {
      const { service, setAutoTitle, emitTurn } = setup({ autoTitle: true, title: "Meters plan" });
      emitTurn();
      await service.idle();
      expect(setAutoTitle).not.toHaveBeenCalled();
    });

    it("never renames twice", async () => {
      const stored: TopicTrail = {
        topics: [],
        yourMove: null,
        basedOnSeq: 0,
        updatedAt: "x",
        card: storedCard({ basedOnSeq: 0, renamed: { from: "price the meters", to: "Old theme", at: "x" } }),
      };
      const { service, setAutoTitle, emitTurn } = setup({ autoTitle: true, stored });
      emitTurn();
      await service.idle();
      expect(setAutoTitle).not.toHaveBeenCalled();
    });

    it("PASEO_AUTO_TITLE=0 leaves titles alone but still writes the card title", async () => {
      const { service, setAutoTitle, setTopicTrail, emitTurn } = setup({
        autoTitle: true,
        env: { PASEO_AUTO_TITLE: "0" },
      });
      emitTurn();
      await service.idle();
      expect(setAutoTitle).not.toHaveBeenCalled();
      const written = (setTopicTrail.mock.calls[0] as unknown as [string, TopicTrail])[1];
      expect(written.card?.title).toBe("Meter pricing for DEE-41");
    });
  });

  it("backfills open sessions that have no card, one at a time, loading each first", async () => {
    const order: string[] = [];
    const rows = [
      { seq: 1, timestamp: "2026-11-17T10:00:00.000Z", item: { type: "user_message", text: "hello" } },
    ];
    const generate = vi.fn(async () => ({ topics: [{ label: "Hello", startSeq: 1 }], yourMove: null, card: MODEL_CARD }));
    const service = new TopicTrailService({
      agentManager: {
        subscribe: () => () => undefined,
        getAgent: (id: string) => (order.includes(`load:${id}`) ? { id, cwd: "/w", internal: false, lifecycle: "idle" } : undefined),
        getTimelineRows: async () => rows,
        fetchTimeline: () => ({ epoch: "ep" }),
        setTopicTrail: async (id: string) => {
          order.push(`write:${id}`);
        },
      } as never,
      agentStorage: {
        get: async () => ({ title: "hello" }),
        list: async () => [
          { id: "old", updatedAt: "2026-11-01T00:00:00.000Z", topicTrail: undefined },
          { id: "new", updatedAt: "2026-11-17T00:00:00.000Z", topicTrail: undefined },
          { id: "done", updatedAt: "2026-11-17T00:00:00.000Z", topicTrail: { card: storedCard() } },
          { id: "gone", updatedAt: "2026-11-17T00:00:00.000Z", archivedAt: "2026-11-17T00:00:00.000Z" },
          { id: "helper", updatedAt: "2026-11-17T00:00:00.000Z", internal: true },
        ],
      } as never,
      providerSnapshotManager: { listProviders: async () => [] },
      logger,
      generate: generate as never,
      env: {},
      loadAgent: async (id: string) => {
        order.push(`load:${id}`);
      },
    });
    await service.backfillCards();
    await service.backfillCards();
    expect(order).toEqual(["load:new", "write:new", "load:old", "write:old"]);
    expect(generate).toHaveBeenCalledTimes(2);
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

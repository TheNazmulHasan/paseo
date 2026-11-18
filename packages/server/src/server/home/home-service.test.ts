import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeSnapshot } from "@getpaseo/protocol/home";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import type { BriefCard } from "./home-brief.js";
import { HomeService } from "./home-service.js";

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

function card(extra: Partial<HomeCard> = {}): HomeCard {
  return {
    what: "x",
    status: "x",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Do it",
    urgency: "today",
    importance: "medium",
    why: "x",
    looksFinished: false,
    stopped: false,
    openItems: [],
    basedOnSeq: 1,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...extra,
  };
}

const cards = (n: number, seq = 1): BriefCard[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    title: `S${i}`,
    workspace: "W",
    folder: "F",
    state: "parked" as const,
    card: card({ basedOnSeq: seq }),
    lastActivityAt: 0,
  }));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "home-service-"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function make(options: { list?: () => BriefCard[]; fail?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  let current = options.list ?? (() => cards(2));
  const generate = vi.fn(async () => {
    if (options.fail) throw new Error("model down");
    return {
      headline: "One thing waits on you.",
      since: null,
      queue: [{ id: "s1", group: "now" as const }],
      checkOn: ["s0"],
      superseded: [],
    };
  });
  const service = new HomeService({
    paseoHome: dir,
    listCards: async () => current(),
    countClosedToday: async () => 3,
    manager: {} as never,
    resolveProviders: async () => [{ provider: "antigravity" }],
    logger,
    generate: generate as never,
    env: options.env ?? {},
    debounceMs: 1000,
    minIntervalMs: 10_000,
    startupDelayMs: 500,
  });
  return {
    service,
    generate,
    setCards: (next: () => BriefCard[]) => {
      current = next;
    },
  };
}

describe("HomeService brief", () => {
  it("writes a brief after cards change (debounced) and caches it on disk", async () => {
    const { service, generate } = make();
    await service.start();
    service.noteCardsChanged();
    service.noteCardsChanged();
    await vi.advanceTimersByTimeAsync(1000);
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    const snapshot = await service.getSnapshot();
    expect(snapshot.brief?.headline).toBe("One thing waits on you.");
    expect(snapshot.brief?.queue).toEqual([{ id: "s1", group: "now" }]);
    expect(snapshot.closedToday).toBe(3);
    expect(JSON.parse(readFileSync(path.join(dir, "home", "brief.json"), "utf8")).headline).toBe(
      "One thing waits on you.",
    );
  });

  it("never runs more often than the minimum interval", async () => {
    const { service, generate, setCards } = make();
    await service.start();
    service.noteCardsChanged();
    await vi.advanceTimersByTimeAsync(1000);
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    setCards(() => cards(3, 2));
    service.noteCardsChanged();
    await vi.advanceTimersByTimeAsync(5000);
    expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("skips the model when nothing changed since the last brief", async () => {
    const { service, generate } = make();
    await service.start();
    service.noteCardsChanged();
    await vi.advanceTimersByTimeAsync(1000);
    await service.idle();
    service.noteCardsChanged();
    await vi.advanceTimersByTimeAsync(10_000);
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("a forced refresh runs even when nothing changed, and waits when asked", async () => {
    const { service, generate } = make();
    await service.start();
    await service.refresh({ wait: true });
    await service.refresh({ wait: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("refresh without waiting returns at once with briefRunning, and the push follows", async () => {
    const { service } = make();
    await service.start();
    const pushed: HomeSnapshot[] = [];
    service.subscribe((snapshot) => pushed.push(snapshot));
    const snapshot = await service.refresh({ wait: false });
    expect(snapshot.briefRunning).toBe(true);
    await service.idle();
    expect(pushed.at(-1)?.briefRunning).toBe(false);
    expect(pushed.at(-1)?.brief?.headline).toBe("One thing waits on you.");
  });

  it("a failing model keeps the old brief and does not throw", async () => {
    const { service } = make({ fail: true });
    await service.start();
    await expect(service.refresh({ wait: true })).resolves.toMatchObject({ brief: null, briefRunning: false });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("with nothing open it writes the clear brief without a model call", async () => {
    const { service, generate } = make({ list: () => [] });
    await service.start();
    const snapshot = await service.refresh({ wait: true });
    expect(generate).not.toHaveBeenCalled();
    expect(snapshot.brief?.headline).toMatch(/clear/i);
  });

  it("PASEO_HOME_BRIEF=0 is fully off", async () => {
    const { service, generate } = make({ env: { PASEO_HOME_BRIEF: "0" } });
    await service.start();
    service.noteCardsChanged();
    await service.refresh({ wait: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generate).not.toHaveBeenCalled();
  });

  it("writes a first brief shortly after boot when none is cached", async () => {
    const { service, generate } = make();
    await service.start();
    await vi.advanceTimersByTimeAsync(500);
    await service.idle();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("loads the cached brief on start and does not rewrite a fresh one", async () => {
    const first = make();
    await first.service.start();
    await first.service.refresh({ wait: true });
    first.service.dispose();
    const second = make();
    await second.service.start();
    expect((await second.service.getSnapshot()).brief?.headline).toBe("One thing waits on you.");
    await vi.advanceTimersByTimeAsync(2000);
    await second.service.idle();
    expect(second.generate).not.toHaveBeenCalled();
  });
});

describe("HomeService state", () => {
  it("snooze, keep and layout change the snapshot and push it", async () => {
    const { service } = make();
    await service.start();
    const pushed: HomeSnapshot[] = [];
    service.subscribe((snapshot) => pushed.push(snapshot));
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await service.snooze("s0", until);
    await service.keep("s1", true);
    await service.setLayout({
      title: "Your 1",
      reason: "because you asked",
      createdAt: new Date().toISOString(),
      groups: [{ label: "First", items: [{ agentId: "s0" }] }],
    });
    const state = (await service.getSnapshot()).state;
    expect(state.snoozed).toEqual({ s0: until });
    expect(Object.keys(state.kept)).toEqual(["s1"]);
    expect(state.chiefLayout?.title).toBe("Your 1");
    expect(pushed).toHaveLength(3);
    await service.setLayout(null);
    expect((await service.getSnapshot()).state.chiefLayout).toBeNull();
  });
});

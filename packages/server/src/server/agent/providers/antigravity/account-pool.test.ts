import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountPool, mapToAvailableModelLabel } from "./account-pool.js";
import { AccountRegistryReader } from "./accounts.js";
import {
  GEMINI_MODELS,
  WITH_CLAUDE,
  fakeRunner,
  usageText,
  type FakeAccountData,
} from "./test-support.js";

describe("mapToAvailableModelLabel", () => {
  const available = [
    "Gemini 3.8 Flash (Medium)",
    "Gemini 3.7 Flash (Medium)",
    "Gemini 3.8 Flash (High)",
    "Gemini 3.1 Pro (High)",
    "Claude Sonnet 5.5 (Medium)",
  ];

  it("keeps a label agy still lists", () => {
    expect(mapToAvailableModelLabel("Gemini 3.1 Pro (High)", available)).toBe(
      "Gemini 3.1 Pro (High)",
    );
  });

  it("maps a retired Flash label to the newest version with the same tier", () => {
    expect(mapToAvailableModelLabel("Gemini 3.5 Flash (Medium)", available)).toBe(
      "Gemini 3.8 Flash (Medium)",
    );
    expect(mapToAvailableModelLabel("Gemini 3.5 Flash (High)", available)).toBe(
      "Gemini 3.8 Flash (High)",
    );
  });

  it("falls back to the Medium tier of the same model name, else null", () => {
    expect(mapToAvailableModelLabel("Claude Sonnet 4.6 (Thinking)", available)).toBe(
      "Claude Sonnet 5.5 (Medium)",
    );
    expect(mapToAvailableModelLabel("Claude Opus 4.6 (Thinking)", available)).toBeNull();
  });
});

describe("AccountPool.pick", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agy-pool-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makePool(
    table: Record<string, FakeAccountData>,
    accounts: Array<{ id: string; home: string; enabled?: boolean }>,
    extra: { now?: () => number } = {},
  ) {
    const filePath = path.join(dir, "google-accounts.json");
    writeFileSync(filePath, JSON.stringify({ accounts }));
    const { runner, calls } = fakeRunner(table);
    const pool = new AccountPool({
      registry: new AccountRegistryReader({ filePath, homeDir: "/home/main" }),
      runner,
      logger: pino({ level: "silent" }),
      homeDir: "/home/main",
      ...extra,
    });
    return { pool, calls };
  }

  const MAIN = { id: "main", home: "/home/main" };
  const CSERU = { id: "cseru", home: "/home/cseru" };

  it("picks the account with the most quota left for the model's family", async () => {
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 20, claude5h: 90 }), models: WITH_CLAUDE },
        "/home/cseru": { usage: usageText({ gemini5h: 99, claude5h: 10 }), models: WITH_CLAUDE },
      },
      [MAIN, CSERU],
    );
    expect((await pool.pick({ model: "Gemini 3.1 Pro (High)" }))?.account.id).toBe("cseru");
    expect((await pool.pick({ model: "Claude Opus 5.5 (Medium)" }))?.account.id).toBe("main");
  });

  it("uses the lower of the 5-hour and weekly windows", async () => {
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 90, geminiWeek: 5 }), models: GEMINI_MODELS },
        "/home/cseru": {
          usage: usageText({ gemini5h: 40, geminiWeek: 60 }),
          models: GEMINI_MODELS,
        },
      },
      [MAIN, CSERU],
    );
    expect((await pool.pick({ model: "Gemini 3.1 Pro (High)" }))?.account.id).toBe("cseru");
  });

  it("drops accounts whose model list lacks the model", async () => {
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 10, claude5h: 10 }), models: WITH_CLAUDE },
        "/home/cseru": {
          usage: usageText({ gemini5h: 100, claude5h: 100 }),
          models: GEMINI_MODELS,
        },
      },
      [MAIN, CSERU],
    );
    expect((await pool.pick({ model: "Claude Opus 5.5 (Medium)" }))?.account.id).toBe("main");
  });

  it("does not disqualify everyone for a model nobody lists", async () => {
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 10 }), models: GEMINI_MODELS },
        "/home/cseru": { usage: usageText({ gemini5h: 80 }), models: GEMINI_MODELS },
      },
      [MAIN, CSERU],
    );
    expect((await pool.pick({ model: "Gemini 3.5 Flash (Medium)" }))?.account.id).toBe("cseru");
  });

  it("breaks ties by registry order", async () => {
    const same = { usage: usageText({ gemini5h: 70 }), models: GEMINI_MODELS };
    const { pool } = makePool({ "/home/main": same, "/home/cseru": same }, [CSERU, MAIN]);
    expect((await pool.pick({ model: "Gemini 3.1 Pro (High)" }))?.account.id).toBe("cseru");
  });

  it("skips an account whose probe failed", async () => {
    const { pool } = makePool(
      {
        "/home/main": { failUsage: true, models: GEMINI_MODELS },
        "/home/cseru": { usage: usageText({ gemini5h: 5 }), models: GEMINI_MODELS },
      },
      [MAIN, CSERU],
    );
    const picked = await pool.pick({ model: "Gemini 3.1 Pro (High)" });
    expect(picked?.account.id).toBe("cseru");
    expect(picked?.fellBack).toBe(false);
  });

  it("falls back to main when every probe fails", async () => {
    const { pool } = makePool(
      {
        "/home/main": { failUsage: true, failModels: true },
        "/home/cseru": { failUsage: true, failModels: true },
      },
      [CSERU, MAIN],
    );
    const picked = await pool.pick({ model: "Gemini 3.1 Pro (High)" });
    expect(picked).toMatchObject({ fellBack: true });
    expect(picked?.account.id).toBe("main");
  });

  it("honours exclude and returns null when it removes everyone", async () => {
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 90 }), models: GEMINI_MODELS },
        "/home/cseru": { usage: usageText({ gemini5h: 10 }), models: GEMINI_MODELS },
      },
      [MAIN, CSERU],
    );
    expect(
      (await pool.pick({ model: "Gemini 3.1 Pro (High)", exclude: new Set(["main"]) }))?.account.id,
    ).toBe("cseru");
    expect(
      await pool.pick({ model: "Gemini 3.1 Pro (High)", exclude: new Set(["main", "cseru"]) }),
    ).toBeNull();
  });

  it("treats an exhausted marker as 0% until the reset time", async () => {
    let now = 1_000_000;
    const { pool } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 90 }), models: GEMINI_MODELS },
        "/home/cseru": { usage: usageText({ gemini5h: 10 }), models: GEMINI_MODELS },
      },
      [MAIN, CSERU],
      { now: () => now },
    );
    const main = pool.getAccount("main")!;
    pool.markExhausted(main, "gemini", 60_000);
    expect((await pool.pick({ model: "Gemini 3.1 Pro (High)" }))?.account.id).toBe("cseru");
    now += 61_000;
    expect(pool.exhaustedUntil(main, "gemini")).toBeNull();
  });

  it("caches usage and models, probing each account once per TTL", async () => {
    let now = 0;
    const { pool, calls } = makePool(
      {
        "/home/main": { usage: usageText({ gemini5h: 90 }), models: GEMINI_MODELS },
        "/home/cseru": { usage: usageText({ gemini5h: 10 }), models: GEMINI_MODELS },
      },
      [MAIN, CSERU],
      { now: () => now },
    );
    await pool.pick({ model: "Gemini 3.1 Pro (High)" });
    await pool.pick({ model: "Gemini 3.1 Pro (High)" });
    expect(calls).toHaveLength(4);
    now += 61_000;
    await pool.pick({ model: "Gemini 3.1 Pro (High)" });
    expect(calls.filter((c) => c.args[0] === "--print")).toHaveLength(4);
    expect(calls.filter((c) => c.args[0] === "models")).toHaveLength(2);
  });
});

describe("AccountPool catalog and dropdown", () => {
  it("unions models across accounts deduped by id, in first-seen order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agy-pool-"));
    try {
      const filePath = path.join(dir, "google-accounts.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          accounts: [
            { id: "main", home: "/home/main" },
            { id: "cseru", home: "/home/cseru" },
          ],
        }),
      );
      const { runner } = fakeRunner({
        "/home/main": { models: WITH_CLAUDE, usage: usageText({ gemini5h: 99, claude5h: 100 }) },
        "/home/cseru": { models: GEMINI_MODELS, usage: usageText({ gemini5h: 99, claude5h: 100 }) },
      });
      const pool = new AccountPool({
        registry: new AccountRegistryReader({ filePath, homeDir: "/home/main" }),
        runner,
        logger: pino({ level: "silent" }),
        homeDir: "/home/main",
      });
      const union = await pool.listModelUnion();
      expect(union?.map((m) => m.label)).toEqual([
        "Gemini 3.8 Flash (Medium)",
        "Gemini 3.1 Pro (High)",
        "Claude Opus 5.5 (Medium)",
      ]);

      await pool.refreshUsage();
      const feature = pool.buildAccountFeature("auto");
      expect(feature).toMatchObject({
        id: "account",
        label: "Account",
        type: "select",
        value: "auto",
      });
      expect(feature.options.map((o) => o.id)).toEqual(["auto", "main", "cseru"]);
      expect(feature.options[0]?.label).toBe("Auto (most quota left)");
      expect(feature.options[2]?.label).toBe("cseru · Gemini 99% · Claude 100%");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when every models probe fails (caller uses the static fallback)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agy-pool-"));
    try {
      const { runner } = fakeRunner({ "/home/main": { failModels: true } });
      const pool = new AccountPool({
        registry: new AccountRegistryReader({
          filePath: path.join(dir, "missing.json"),
          homeDir: "/home/main",
        }),
        runner,
        logger: pino({ level: "silent" }),
        homeDir: "/home/main",
      });
      expect(await pool.listModelUnion()).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

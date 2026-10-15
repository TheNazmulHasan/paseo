import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentSession, AgentStreamEvent } from "../../agent-sdk-types.js";
import { AccountPool } from "./account-pool.js";
import { AccountRegistryReader } from "./accounts.js";
import { AntigravityAgentClient } from "./agent.js";
import {
  GEMINI_MODELS,
  WITH_CLAUDE,
  fakeRunner,
  usageText,
  type FakeAccountData,
} from "./test-support.js";

const QUOTA_ERR =
  "Print mode: run ended with error and no response: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h30m0s.";

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface Script {
  stdout?: string;
  stderr?: string;
  code?: number;
}

function fakeSpawn(scripts: Script[]) {
  const calls: SpawnCall[] = [];
  const spawnProcess = ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ command, args, env: options.env });
    const script = scripts[calls.length - 1] ?? { stdout: "ok\n", code: 0 };
    const proc = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => true;
    setImmediate(() => {
      if (script.stderr) proc.stderr.write(script.stderr);
      if (script.stdout) proc.stdout.write(script.stdout);
      proc.stdout.end();
      proc.stderr.end();
      // Let readline flush its lines before close.
      setTimeout(() => proc.emit("close", script.code ?? 0), 5);
    });
    return proc;
  }) as unknown as typeof spawn;
  return { spawnProcess, calls };
}

function collect(session: AgentSession) {
  const events: AgentStreamEvent[] = [];
  const done = new Promise<void>((resolve) => {
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "turn_completed" || event.type === "turn_failed") resolve();
    });
  });
  return { events, done };
}

function notes(events: AgentStreamEvent[]): string[] {
  return events.flatMap((e) =>
    e.type === "timeline" && e.item.type === "notification" ? [e.item.message] : [],
  );
}

describe("Antigravity multi-account sessions", () => {
  let dir: string;
  let mainHome: string;
  let cseruHome: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agy-accounts-"));
    mainHome = path.join(dir, "main");
    cseruHome = path.join(dir, "cseru");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeClient(
    table: Record<string, FakeAccountData>,
    scripts: Script[],
    options: { accounts?: boolean } = { accounts: true },
  ) {
    const filePath = path.join(dir, "google-accounts.json");
    if (options.accounts !== false) {
      writeFileSync(
        filePath,
        JSON.stringify({
          accounts: [
            { id: "main", email: "main@gmail.com", home: mainHome },
            { id: "cseru", email: "spare.one@gmail.com", home: cseruHome },
          ],
        }),
      );
    }
    const logger = pino({ level: "silent" });
    const { runner } = fakeRunner(table);
    const pool = new AccountPool({
      registry: new AccountRegistryReader({ filePath, homeDir: mainHome, logger }),
      runner,
      logger,
      homeDir: mainHome,
    });
    const spawned = fakeSpawn(scripts);
    const client = new AntigravityAgentClient({
      logger,
      accountPool: pool,
      spawnProcess: spawned.spawnProcess,
    });
    return { client, pool, spawned };
  }

  const bothHealthy = (): Record<string, FakeAccountData> => ({
    [mainHome]: { usage: usageText({ gemini5h: 100, claude5h: 100 }), models: WITH_CLAUDE },
    [cseruHome]: { usage: usageText({ gemini5h: 50, claude5h: 50 }), models: GEMINI_MODELS },
  });

  it("spawns agy with HOME set to the pinned account and passes the model with --model", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "hi\n" }]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.1 Pro (High)",
      featureValues: { account: "cseru" },
    });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls).toHaveLength(1);
    expect(spawned.calls[0]?.env.HOME).toBe(cseruHome);
    const args = spawned.calls[0]!.args;
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
      "--model",
      "Gemini 3.1 Pro (High)",
    ]);
    expect(args).toContain("--print");
  });

  it("auto picks the account with the most quota and reports it as the feature value", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "hi\n" }]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.1 Pro (High)",
    });
    expect(session.features?.[0]).toMatchObject({ id: "account", value: "auto" });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls[0]?.env.HOME).toBe(mainHome);
    expect(session.features?.[0]).toMatchObject({ value: "main" });
  });

  it("auto chooses the only account that lists a Claude model", async () => {
    const table = bothHealthy();
    table[cseruHome] = {
      usage: usageText({ gemini5h: 100, claude5h: 100 }),
      models: GEMINI_MODELS,
    };
    table[mainHome] = { usage: usageText({ gemini5h: 10, claude5h: 10 }), models: WITH_CLAUDE };
    const { client, spawned } = makeClient(table, [{ stdout: "hi\n" }]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Claude Opus 5.5 (Medium)",
    });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls[0]?.env.HOME).toBe(mainHome);
  });

  it("falls back to main when every probe fails", async () => {
    const table = {
      [mainHome]: { failUsage: true, failModels: true },
      [cseruHome]: { failUsage: true, failModels: true },
    };
    const { client, spawned } = makeClient(table, [{ stdout: "hi\n" }]);
    const session = await client.createSession({ provider: "antigravity", cwd: dir });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls[0]?.env.HOME).toBe(mainHome);
  });

  it("auto: a quota failure retries once on the next best account with a visible note", async () => {
    const { client, spawned, pool } = makeClient(bothHealthy(), [
      { stderr: `${QUOTA_ERR}\n`, code: 1 },
      { stdout: "answer\n" },
    ]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.1 Pro (High)",
    });
    const { events, done } = collect(session);
    await session.startTurn("hello");
    await done;

    expect(spawned.calls.map((c) => c.env.HOME)).toEqual([mainHome, cseruHome]);
    expect(notes(events)).toContain("Switched account: main → cseru (quota)");
    expect(events.some((e) => e.type === "turn_completed")).toBe(true);
    expect(events.some((e) => e.type === "turn_failed")).toBe(false);
    expect(pool.exhaustedUntil(pool.getAccount("main")!, "gemini")).not.toBeNull();
    expect(session.features?.[0]).toMatchObject({ value: "cseru" });
  });

  it("auto: retries only once even if the second account is also out of quota", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [
      { stderr: QUOTA_ERR, code: 1 },
      { stderr: QUOTA_ERR, code: 1 },
      { stdout: "never reached\n" },
    ]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.1 Pro (High)",
    });
    const { events, done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls).toHaveLength(2);
    const failed = events.find((e) => e.type === "turn_failed");
    expect(failed).toMatchObject({ code: "quota_exhausted" });
  });

  it("pinned account: a quota failure names the account and reset time, with no retry", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stderr: QUOTA_ERR, code: 1 }]);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.1 Pro (High)",
      featureValues: { account: "cseru" },
    });
    const { events, done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls).toHaveLength(1);
    const failed = events.find((e) => e.type === "turn_failed");
    expect(failed && failed.type === "turn_failed" ? failed.error : "").toMatch(
      /account "spare\.one" is out of Gemini quota\. Resets in 2h 30m/,
    );
  });

  it("switching account starts a NEW conversation in the new account's HOME", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "ok\n" }]);
    const session = await client.resumeSession(
      {
        provider: "antigravity",
        sessionId: "s1",
        nativeHandle: "conv-123",
        metadata: { antigravityAccount: "main" },
      },
      { cwd: dir, model: "Gemini 3.1 Pro (High)", featureValues: { account: "main" } },
    );
    expect(session.id).toBe("conv-123");

    await session.setFeature?.("account", "cseru");
    const { events, done } = collect(session);
    await session.startTurn("hello");
    await done;

    const call = spawned.calls[0]!;
    expect(call.env.HOME).toBe(cseruHome);
    expect(call.args).not.toContain("--conversation");
    expect(notes(events)).toContain("Switched account: main → cseru (new conversation)");
    expect(session.id).toBeNull();
  });

  it("resume continues the stored conversation in the stored account's HOME", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "ok\n" }]);
    const session = await client.resumeSession(
      {
        provider: "antigravity",
        sessionId: "s1",
        nativeHandle: "conv-xyz",
        metadata: { antigravityAccount: "cseru" },
      },
      // Auto, and main has far more quota: the conversation still stays on cseru.
      { cwd: dir, model: "Gemini 3.1 Pro (High)" },
    );
    expect(session.features?.[0]).toMatchObject({ value: "cseru" });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    const call = spawned.calls[0]!;
    expect(call.env.HOME).toBe(cseruHome);
    expect(call.args.slice(0, 2)).toEqual(["--conversation", "conv-xyz"]);
  });

  it("a handle from before accounts existed resumes in main", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "ok\n" }]);
    const session = await client.resumeSession(
      { provider: "antigravity", sessionId: "s1", nativeHandle: "old-conv" },
      { cwd: dir, model: "Gemini 3.1 Pro (High)" },
    );
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    expect(spawned.calls[0]?.env.HOME).toBe(mainHome);
    expect(spawned.calls[0]?.args.slice(0, 2)).toEqual(["--conversation", "old-conv"]);
  });

  it("maps a retired stored model label onto the current one", async () => {
    const { client, spawned } = makeClient(bothHealthy(), [{ stdout: "ok\n" }]);
    await client.fetchCatalog({ scope: "global", force: true } as never);
    const session = await client.createSession({
      provider: "antigravity",
      cwd: dir,
      model: "Gemini 3.5 Flash (Medium)",
      featureValues: { account: "main" },
    });
    const { done } = collect(session);
    await session.startTurn("hello");
    await done;
    const args = spawned.calls[0]!.args;
    expect(args[args.indexOf("--model") + 1]).toBe("Gemini 3.8 Flash (Medium)");
  });

  it("records the owning account in the persistence handle once a conversation exists", async () => {
    const { client } = makeClient(bothHealthy(), []);
    const session = await client.resumeSession(
      {
        provider: "antigravity",
        sessionId: "s1",
        nativeHandle: "c1",
        metadata: { antigravityAccount: "cseru" },
      },
      { cwd: dir },
    );
    expect(session.describePersistence()?.metadata).toEqual({ antigravityAccount: "cseru" });
  });

  it("setFeature rejects unknown accounts", async () => {
    const { client } = makeClient(bothHealthy(), []);
    const session = await client.createSession({ provider: "antigravity", cwd: dir });
    await expect(session.setFeature?.("account", "nobody")).rejects.toThrow(/not enabled/);
  });
});

describe("Antigravity without a registry file", () => {
  it("behaves like the single-login provider: no Account menu, main at the real home", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agy-noreg-"));
    try {
      const logger = pino({ level: "silent" });
      const { runner } = fakeRunner({
        [dir]: { usage: usageText({ gemini5h: 1 }), models: GEMINI_MODELS },
      });
      const pool = new AccountPool({
        registry: new AccountRegistryReader({
          filePath: path.join(dir, "none.json"),
          homeDir: dir,
        }),
        runner,
        logger,
        homeDir: dir,
      });
      const spawned = fakeSpawn([{ stdout: "ok\n" }]);
      const client = new AntigravityAgentClient({
        logger,
        accountPool: pool,
        spawnProcess: spawned.spawnProcess,
      });
      expect(await client.listFeatures({ provider: "antigravity", cwd: dir })).toEqual([]);
      const session = await client.createSession({ provider: "antigravity", cwd: dir });
      expect(session.features).toEqual([]);
      const { done } = collect(session);
      await session.startTurn("hello");
      await done;
      expect(spawned.calls[0]?.env.HOME).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listFeatures returns the Account select with Auto as default when accounts exist", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agy-feat-"));
    try {
      const filePath = path.join(dir, "google-accounts.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          accounts: [
            { id: "main", email: "a@gmail.com", home: path.join(dir, "m") },
            { id: "cseru", email: "spare.one@gmail.com", home: path.join(dir, "c") },
          ],
        }),
      );
      const logger = pino({ level: "silent" });
      const { runner } = fakeRunner({
        [path.join(dir, "m")]: {
          usage: usageText({ gemini5h: 12, claude5h: 100 }),
          models: WITH_CLAUDE,
        },
        [path.join(dir, "c")]: {
          usage: usageText({ gemini5h: 99, claude5h: 100 }),
          models: GEMINI_MODELS,
        },
      });
      const pool = new AccountPool({
        registry: new AccountRegistryReader({ filePath, homeDir: path.join(dir, "m") }),
        runner,
        logger,
        homeDir: path.join(dir, "m"),
      });
      const client = new AntigravityAgentClient({ logger, accountPool: pool });
      const [feature] = await client.listFeatures({ provider: "antigravity", cwd: dir });
      expect(feature).toMatchObject({
        type: "select",
        id: "account",
        label: "Account",
        value: "auto",
      });
      expect(feature?.type === "select" ? feature.options.map((o) => o.label) : []).toEqual([
        "Auto (most quota left)",
        "a · Gemini 12% · Claude 100%",
        "spare.one · Gemini 99% · Claude 100%",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

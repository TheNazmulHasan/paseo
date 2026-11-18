import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PaseoToolConfig, PaseoToolDefinition } from "../agent/tools/types.js";
import {
  createAppCommandBus,
  type AppCommandBus,
  type AppCommandSession,
} from "./app-command-bus.js";
import { dispatchChiefMessage } from "./chief-session.js";
import { createChiefCore, registerChiefTools, type ChiefToolsOptions } from "./chief-tools.js";
import type { AgentStateSource, WorkspaceSource } from "./session-rows.js";
import { createTranscriptLocator } from "./transcripts.js";

let root: string;
let tools: Map<string, PaseoToolDefinition>;

const SERVER = "srv_1";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "chief-tools-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function workspace(id: string, over: Partial<WorkspaceSource> = {}): WorkspaceSource {
  return {
    workspaceId: id,
    projectId: "proj_1",
    cwd: path.join(root, id),
    title: `Title ${id}`,
    displayName: id,
    pinnedAt: null,
    background: false,
    archivedAt: null,
    ...over,
  };
}

function agent(id: string, over: Partial<AgentStateSource> = {}): AgentStateSource {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: "opus",
    workspaceId: "wks_a",
    status: "idle",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...over,
  };
}

function register(over: Partial<ChiefToolsOptions> = {}, bus?: AppCommandBus): void {
  tools = new Map();
  registerChiefTools({
    registerTool: (name: string, config: PaseoToolConfig, handler) => {
      tools.set(name, {
        name,
        title: config.title,
        description: config.description ?? name,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        handler,
      });
    },
    serverId: SERVER,
    paseoHome: root,
    listAgents: async () => [],
    listStoredAgents: async () => [],
    workspaceRegistry: { list: async () => [workspace("wks_a"), workspace("wks_b", { pinnedAt: "x", background: true })] },
    projectRegistry: { list: async () => [{ projectId: "proj_1", displayName: "MyOS" }] },
    folderRegistry: {
      getSnapshot: async () => ({
        folders: [{ id: "fld_1", name: "Faith", emoji: null, order: 0, createdAt: "x" }],
        membership: { wks_a: "fld_1" },
      }),
    },
    ...(bus ? { bus } : {}),
    ...over,
  });
}

async function call(name: string, input: Record<string, unknown> = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.handler(input, {});
  return result.structuredContent as Record<string, any>;
}

describe("registerChiefTools", () => {
  it("registers the four chief tools and Home's four, with agent-readable descriptions", () => {
    register();
    expect([...tools.keys()].sort()).toEqual([
      "app_command",
      "home_get",
      "home_refresh",
      "home_set_layout",
      "home_snooze",
      "list_app_actions",
      "search_sessions",
      "session_states",
    ]);
    for (const tool of tools.values()) expect(tool.description.length).toBeGreaterThan(40);
  });
});

describe("session_states", () => {
  beforeEach(() => {
    register({
      listAgents: async () => [
        agent("parked1"),
        agent("move1", { requiresAttention: true, attentionReason: "finished", topicTrail: { yourMove: "Pick a colour" } }),
        agent("run1", { status: "running", topicTrail: { yourMove: "ignored while running" } }),
        agent("need1", { pendingPermissions: [{}], workspaceId: "wks_b" }),
        // Home v2 state rule: an error is "stopped", never "needs you".
        agent("crash1", { status: "error", requiresAttention: true, attentionReason: "error", topicTrail: { yourMove: null, card: { what: "x" } as never } }),
        agent("gone", { archivedAt: "2026-11-01T00:00:00.000Z" }),
        agent("helper", { internal: true }),
      ],
      listStoredAgents: async () => [
        { id: "move1", cwd: "/x", updatedAt: "2026-11-09T00:00:00.000Z", lastActivityAt: "2026-11-16T00:00:00.000Z" },
      ],
    });
  });

  it("returns non-archived, non-internal sessions sorted by state, with context and links", async () => {
    const out = await call("session_states");
    expect(out.sessions.map((s: any) => s.agentId)).toEqual([
      "need1",
      "run1",
      "move1",
      "crash1",
      "parked1",
    ]);
    expect(out.matched).toBe(5);
    expect(out.counts).toEqual({ needs_you: 1, working: 1, your_move: 1, stopped: 1, parked: 1 });
    expect(out.sessions.find((s: any) => s.agentId === "crash1").state).toBe("stopped");
    // The card is Home's data: it never reaches session_states output.
    expect(out.sessions.every((s: any) => !("card" in s) && !("lastUserMessageAt" in s) && !("chief" in s))).toBe(true);
    const move = out.sessions.find((s: any) => s.agentId === "move1");
    expect(move).toMatchObject({
      state: "your_move",
      yourMoveText: "Pick a colour",
      workspaceId: "wks_a",
      workspaceTitle: "Title wks_a",
      projectName: "MyOS",
      folder: "Faith",
      pinned: false,
      background: false,
      lastActivityAt: "2026-11-16T00:00:00.000Z",
      url: `paseo://h/${SERVER}/agent/move1`,
    });
    expect(move.link).toBe(`[Agent move1](paseo://h/${SERVER}/agent/move1)`);
    expect(move.workspaceLink).toBe(`[Title wks_a](paseo://h/${SERVER}/workspace/wks_a)`);
    const need = out.sessions.find((s: any) => s.agentId === "need1");
    expect(need).toMatchObject({ folder: null, pinned: true, background: true });
    // No "Your move" line while the agent is running.
    expect(out.sessions.find((s: any) => s.agentId === "run1").yourMoveText).toBeNull();
  });

  it("applies state, folder, workspace, staleDays and limit filters", async () => {
    expect((await call("session_states", { state: ["your_move"] })).sessions).toHaveLength(1);
    expect((await call("session_states", { folder: "faith" })).matched).toBe(4);
    expect((await call("session_states", { folder: "unfiled" })).matched).toBe(1);
    expect((await call("session_states", { workspaceId: "wks_b" })).matched).toBe(1);
    expect((await call("session_states", { staleDays: 1 })).matched).toBeGreaterThan(0);
    const limited = await call("session_states", { limit: 2 });
    expect(limited.sessions).toHaveLength(2);
    expect(limited.matched).toBe(5);
  });
});

describe("search_sessions", () => {
  const ID = "55555555-5555-4555-8555-555555555555";

  function writeClaude(text: string): void {
    const dir = path.join(root, "claude", "projects", "-p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${ID}.jsonl`),
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-02T09:00:00.000Z",
        message: { role: "user", content: text },
      }) + "\n",
    );
  }

  function registerWithStored(cwd: string, workspaceId = "wks_a") {
    register({
      listStoredAgents: async () => [
        {
          id: "old1",
          title: "Switchboard planning",
          cwd,
          workspaceId,
          updatedAt: "2026-11-02T09:00:00.000Z",
          archivedAt: "2026-11-03T00:00:00.000Z",
          persistence: { sessionId: ID },
        },
        { id: "helper", cwd, updatedAt: "2026-11-02T09:00:00.000Z", internal: true, persistence: { sessionId: ID } },
      ],
      locator: createTranscriptLocator({ claudeConfigDirs: [path.join(root, "claude")], codexHomes: [], specStory: false }),
    });
  }

  it("finds an archived session and returns workspace, folder, date, who, snippet and link", async () => {
    writeClaude("how does the switchboard pick an account?");
    registerWithStored(path.join(root, "wks_a"));
    const out = await call("search_sessions", { query: "switchboard account" });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]).toMatchObject({
      agentId: "old1",
      title: "Switchboard planning",
      workspaceTitle: "Title wks_a",
      folder: "Faith",
      archived: true,
      date: "2026-11-02T09:00:00.000Z",
      who: "you",
      source: "claude",
      private: false,
      url: `paseo://h/${SERVER}/agent/old1`,
    });
    expect(out.hits[0].snippet).toContain("switchboard pick an account");
    expect(out.hits[0].link).toContain("paseo://h/srv_1/agent/old1");
    expect((await call("search_sessions", { query: "switchboard", includeArchived: false })).hits).toHaveLength(0);
  });

  it("withholds the snippet for a private workspace by default and returns it when chief.json lifts the guard", async () => {
    writeClaude("a private secretword conversation");
    const personal = path.join(root, "personal");
    mkdirSync(personal, { recursive: true });
    writeFileSync(path.join(personal, ".local-only"), "");
    registerWithStored(personal);
    const withheld = await call("search_sessions", { query: "secretword" });
    expect(withheld.hits[0]).toMatchObject({
      title: "Switchboard planning",
      date: "2026-11-02T09:00:00.000Z",
      snippet: "(private workspace — text withheld)",
      private: true,
    });
    expect(JSON.stringify(withheld)).not.toContain("conversation");

    writeFileSync(path.join(root, "chief.json"), JSON.stringify({ searchPrivateText: true }));
    const open = await call("search_sessions", { query: "secretword" });
    expect(open.hits[0].snippet).toContain("private secretword conversation");
  });
});

class FakeSession implements AppCommandSession {
  published: unknown[] = [];
  constructor(
    private readonly subscribed: boolean,
    private readonly onPublish?: (payload: any) => void,
  ) {}
  hasEventSubscriber(): boolean {
    return this.subscribed;
  }
  publish(message: { type: "app_command"; payload: unknown }): void {
    this.published.push(message.payload);
    this.onPublish?.(message.payload);
  }
}

describe("app_command and list_app_actions", () => {
  it("reports delivered=false when no app client is connected", async () => {
    const bus = createAppCommandBus();
    bus.bind(() => [new FakeSession(false)]);
    register({}, bus);
    const out = await call("app_command", { action: "open_workspace", args: { workspaceId: "wks_a" } });
    expect(out).toMatchObject({ delivered: false, clients: 0, ok: null });
    expect(out.error).toContain("No Paseo app is connected");
  });

  it("pushes the command to subscribed clients and returns the app's answer", async () => {
    const bus = createAppCommandBus();
    const app = new FakeSession(true, (command) =>
      void dispatchChiefMessage({ type: "app_command.result.request", commandId: command.id, ok: true }, undefined, bus),
    );
    const bystander = new FakeSession(false);
    bus.bind(() => [app, bystander]);
    register({}, bus);
    const out = await call("app_command", { action: "open_workspace", args: { workspaceId: "wks_a", tabId: "t1" } });
    expect(out).toMatchObject({ delivered: true, clients: 1, ok: true, error: null });
    expect(app.published).toEqual([
      { id: expect.any(String), action: "open_workspace", args: { workspaceId: "wks_a", tabId: "t1" } },
    ]);
    expect(bystander.published).toEqual([]);
  });

  it("gives the app's refusal back to the agent", async () => {
    const bus = createAppCommandBus();
    const app = new FakeSession(true, (command) =>
      dispatchChiefMessage(
        { type: "app_command.result.request", commandId: command.id, ok: false, error: "Unknown action id: nope" },
        undefined,
        bus,
      ),
    );
    bus.bind(() => [app]);
    register({}, bus);
    const out = await call("app_command", { action: "run_action", args: { actionId: "nope" } });
    expect(out).toMatchObject({ delivered: true, ok: false, error: "Unknown action id: nope" });
  });

  it("list_app_actions asks the app and returns its list; fails clearly with no app", async () => {
    const bus = createAppCommandBus();
    const app = new FakeSession(true, (command) =>
      dispatchChiefMessage(
        {
          type: "app_command.result.request",
          commandId: command.id,
          ok: true,
          data: { actions: [{ id: "keyboard:workspace.pin", kind: "keyboard", label: "Pin workspace" }] },
        },
        undefined,
        bus,
      ),
    );
    bus.bind(() => [app]);
    register({}, bus);
    expect(await call("list_app_actions")).toEqual({
      actions: [{ id: "keyboard:workspace.pin", kind: "keyboard", label: "Pin workspace" }],
    });
    expect(app.published[0]).toMatchObject({ action: "list_actions", args: {} });

    bus.bind(() => []);
    await expect(call("list_app_actions")).rejects.toThrow("No Paseo app is connected");
  });
});

describe("dispatchChiefMessage", () => {
  it("ignores messages that are not ours", () => {
    expect(dispatchChiefMessage({ type: "abort_request" } as never)).toBeUndefined();
  });

  it("answers chief.query.request with the same core the tools use, and reports errors", async () => {
    const emitted: any[] = [];
    const core = createChiefCore({
      serverId: SERVER,
      listAgents: async () => [agent("a1", { requiresAttention: true, attentionReason: "finished" })],
      listStoredAgents: async () => [],
      workspaceRegistry: { list: async () => [workspace("wks_a")] },
    });
    const host = { core, emit: (message: any) => emitted.push(message) };

    await dispatchChiefMessage(
      { type: "chief.query.request", requestId: "r1", query: "states", input: { state: ["your_move"] } },
      host,
    );
    expect(emitted[0]).toMatchObject({
      type: "chief.query.response",
      payload: { requestId: "r1", error: null, result: { matched: 1 } },
    });

    await dispatchChiefMessage(
      { type: "chief.query.request", requestId: "r2", query: "search", input: {} },
      host,
    );
    expect(emitted[1].payload).toMatchObject({ requestId: "r2", result: null, error: "query is required" });
  });
});

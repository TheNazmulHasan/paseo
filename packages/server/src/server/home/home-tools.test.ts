import { describe, expect, it, vi } from "vitest";

import { EMPTY_HOME_STATE, type HomeSnapshot } from "@getpaseo/protocol/home";
import type { PaseoToolConfig } from "../agent/tools/types.js";
import { createHomeHub } from "./home-hub.js";
import { registerHomeTools } from "./home-tools.js";

const snapshot: HomeSnapshot = {
  brief: { headline: "Hi", since: null, queue: [], checkOn: [], superseded: [], generatedAt: "2026-11-18T08:00:00.000Z" },
  state: EMPTY_HOME_STATE,
  closedToday: 0,
  briefRunning: false,
  updatedAt: "2026-11-18T08:30:00.000Z",
};

function setup() {
  const tools = new Map<string, { config: PaseoToolConfig; handler: (input: any) => Promise<any> }>();
  const service = {
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    snooze: vi.fn(async (_id: string, until: string | null) => ({
      ...snapshot,
      state: { ...EMPTY_HOME_STATE, snoozed: until ? { a: until } : {} },
    })),
    setLayout: vi.fn(async (layout: unknown) => ({
      ...snapshot,
      state: { ...EMPTY_HOME_STATE, chiefLayout: layout as never },
    })),
    subscribe: () => () => undefined,
  };
  const hub = createHomeHub();
  hub.bind(service as never, () => []);
  registerHomeTools({
    registerTool: (name, config, handler) => void tools.set(name, { config, handler: handler as never }),
    core: { sessionRows: async () => ({ sessions: [{ agentId: "a" }, { agentId: "b" }] as never, matched: 2, counts: {} }) },
    hub,
  });
  const call = async (name: string, input: Record<string, unknown> = {}) =>
    (await tools.get(name)!.handler(input)).structuredContent;
  return { tools, service, call };
}

describe("home tools", () => {
  it("registers home_get, home_refresh, home_snooze and home_set_layout with real descriptions", () => {
    const { tools } = setup();
    expect([...tools.keys()].sort()).toEqual(["home_get", "home_refresh", "home_set_layout", "home_snooze"]);
    for (const { config } of tools.values()) expect((config.description ?? "").length).toBeGreaterThan(40);
  });

  it("home_get says what the screen says", async () => {
    const { call } = setup();
    const out = await call("home_get");
    expect(out.headline).toBe("Hi");
    expect(out.tally.open).toBe(2);
  });

  it("home_refresh waits by default", async () => {
    const { call, service } = setup();
    expect((await call("home_refresh", {})).headline).toBe("Hi");
    expect(service.refresh).toHaveBeenCalledWith({ wait: true });
    await call("home_refresh", { wait: false });
    expect(service.refresh).toHaveBeenLastCalledWith({ wait: false });
  });

  it("home_snooze accepts a preset and reports when it comes back", async () => {
    const { call, service } = setup();
    const out = await call("home_snooze", { agentId: "a", until: "3h" });
    expect(out.agentId).toBe("a");
    expect(out.snoozedUntil).toBe((service.snooze.mock.calls[0] as unknown as [string, string])[1]);
    expect((await call("home_snooze", { agentId: "a", until: null })).snoozedUntil).toBeNull();
  });

  it("home_set_layout stores the layout, reports unknown ids, and null puts it back", async () => {
    const { call, service } = setup();
    const out = await call("home_set_layout", {
      layout: {
        title: "Your 3",
        reason: "because you asked",
        groups: [{ label: "First", items: [{ agentId: "a", line: "Go" }, { agentId: "ghost" }] }],
      },
    });
    expect(out).toEqual({ active: true, items: 2, unknownIds: ["ghost"] });
    expect(service.setLayout.mock.calls[0][0]).toMatchObject({ title: "Your 3" });
    expect(await call("home_set_layout", { layout: null })).toEqual({ active: false, items: 0, unknownIds: [] });
  });

  it("home_set_layout refuses a layout of ids that are not open sessions", async () => {
    const { tools } = setup();
    await expect(
      tools.get("home_set_layout")!.handler({
        layout: { title: "x", reason: "y", groups: [{ label: "z", items: [{ agentId: "ghost" }] }] },
      }),
    ).rejects.toThrow(/home_get/);
  });
});

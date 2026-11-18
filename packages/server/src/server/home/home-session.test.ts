import { describe, expect, it, vi } from "vitest";

import { EMPTY_HOME_STATE, type HomeSnapshot } from "@getpaseo/protocol/home";
import type { SessionInboundMessage } from "../messages.js";
import { dispatchChiefMessage } from "../chief/chief-session.js";
import { createHomeHub } from "./home-hub.js";
import { dispatchHomeMessage, parseSnoozeUntil } from "./home-session.js";

const snapshot: HomeSnapshot = {
  brief: null,
  state: EMPTY_HOME_STATE,
  closedToday: 0,
  briefRunning: false,
  updatedAt: "2026-11-18T08:30:00.000Z",
};

function fakeService() {
  return {
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => ({ ...snapshot, briefRunning: true })),
    snooze: vi.fn(async () => snapshot),
    keep: vi.fn(async () => snapshot),
    setLayout: vi.fn(async () => snapshot),
    subscribe: vi.fn(() => () => undefined),
  };
}

function request(action: string, input: Record<string, unknown> = {}): SessionInboundMessage {
  return { type: "home.request", requestId: "r1", action, input } as SessionInboundMessage;
}

async function run(message: SessionInboundMessage, service = fakeService()) {
  const hub = createHomeHub();
  hub.bind(service as never, () => []);
  const emitted: any[] = [];
  await dispatchHomeMessage(message, { emit: (m) => emitted.push(m) }, hub);
  return { emitted, service };
}

describe("dispatchHomeMessage", () => {
  it("ignores messages that are not home.request", () => {
    expect(dispatchHomeMessage({ type: "ping" } as never, { emit: () => undefined })).toBeUndefined();
  });

  it("get returns the snapshot", async () => {
    const { emitted } = await run(request("get"));
    expect(emitted).toEqual([{ type: "home.response", payload: { requestId: "r1", snapshot, error: null } }]);
  });

  it("refresh does not wait for the model", async () => {
    const { service, emitted } = await run(request("refresh"));
    expect(service.refresh).toHaveBeenCalledWith({ wait: false });
    expect(emitted[0].payload.snapshot.briefRunning).toBe(true);
  });

  it("snooze resolves a preset to an ISO time; null brings it back", async () => {
    const { service } = await run(request("snooze", { agentId: "a", until: "tomorrow" }));
    const until = (service.snooze.mock.calls[0] as unknown as [string, string])[1];
    expect(Number.isNaN(Date.parse(until))).toBe(false);
    expect(new Date(until).getHours()).toBe(9);
    const again = await run(request("snooze", { agentId: "a", until: null }));
    expect(again.service.snooze).toHaveBeenCalledWith("a", null);
  });

  it("keep defaults to true and false releases", async () => {
    expect((await run(request("keep", { agentId: "a" }))).service.keep).toHaveBeenCalledWith("a", true);
    expect((await run(request("keep", { agentId: "a", keep: false }))).service.keep).toHaveBeenCalledWith("a", false);
  });

  it("set_layout validates the layout and null clears", async () => {
    const layout = {
      title: "Your 1",
      reason: "because you asked",
      createdAt: "2026-11-18T08:40:00.000Z",
      groups: [{ label: "First", items: [{ agentId: "a" }] }],
    };
    expect((await run(request("set_layout", { layout }))).service.setLayout).toHaveBeenCalledWith(layout);
    expect((await run(request("set_layout", { layout: null }))).service.setLayout).toHaveBeenCalledWith(null);
    const bad = await run(request("set_layout", { layout: { title: 3 } }));
    expect(bad.emitted[0].payload.error).toBeTruthy();
    expect(bad.emitted[0].payload.snapshot).toBeNull();
  });

  it("answers an error, never throws, when the input is wrong or Home is not running", async () => {
    const missing = await run(request("snooze", {}));
    expect(missing.emitted[0].payload.error).toBe("agentId is required");
    const hub = createHomeHub();
    const emitted: any[] = [];
    await dispatchHomeMessage(request("get"), { emit: (m) => emitted.push(m) }, hub);
    expect(emitted[0].payload.error).toMatch(/not running/);
  });

  it("rides the chief dispatcher, so session.ts needs no new line", async () => {
    const emitted: any[] = [];
    const hub = createHomeHub();
    hub.bind(fakeService() as never, () => []);
    // The module singleton is empty in this test: the answer is the "not running" error, which
    // proves the message reached the Home dispatcher through dispatchChiefMessage.
    await dispatchChiefMessage(request("get"), { core: {} as never, emit: (m) => emitted.push(m) });
    expect(emitted[0].type).toBe("home.response");
  });
});

describe("parseSnoozeUntil", () => {
  const now = new Date(2026, 10, 18, 14, 0, 0);
  it("accepts presets, ISO times and null", () => {
    expect(new Date(parseSnoozeUntil("3h", now) as string).getTime() - now.getTime()).toBe(3 * 3_600_000);
    expect(parseSnoozeUntil("2026-11-20T10:00:00Z", now)).toBe("2026-11-20T10:00:00.000Z");
    expect(parseSnoozeUntil(null, now)).toBeNull();
    expect(parseSnoozeUntil(undefined, now)).toBeNull();
  });
  it("rejects anything else", () => {
    expect(() => parseSnoozeUntil("soon", now)).toThrow();
    expect(() => parseSnoozeUntil(5, now)).toThrow();
  });
});

describe("home hub", () => {
  it("pushes every change to subscribed sessions only, and unbinds cleanly", () => {
    const hub = createHomeHub();
    let listener: ((s: HomeSnapshot) => void) | null = null;
    const service = {
      subscribe: (fn: (s: HomeSnapshot) => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    };
    const subscribed = { hasEventSubscriber: () => true, publish: vi.fn() };
    const other = { hasEventSubscriber: () => false, publish: vi.fn() };
    hub.bind(service as never, () => [subscribed, other]);
    listener!(snapshot);
    expect(subscribed.publish).toHaveBeenCalledWith({ type: "home_update", payload: snapshot });
    expect(other.publish).not.toHaveBeenCalled();
    hub.bind(null, () => []);
    expect(listener).toBeNull();
    expect(hub.available()).toBe(false);
    expect(() => hub.service()).toThrow(/not running/);
  });
});

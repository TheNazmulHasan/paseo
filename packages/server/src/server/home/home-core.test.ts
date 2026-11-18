import { describe, expect, it } from "vitest";

import { EMPTY_HOME_STATE, type HomeSnapshot } from "@getpaseo/protocol/home";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import type { SessionStateRow } from "../chief/session-rows.js";
import { buildHomeGet } from "./home-core.js";

const NOW = Date.parse("2026-11-18T08:30:00.000Z");

function card(extra: Partial<HomeCard> = {}): HomeCard {
  return {
    title: "Google OAuth secret for Riajul",
    what: "OAuth",
    status: "Secret saved.",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Tell Riajul yes",
    urgency: "now",
    importance: "high",
    why: "Riajul waits.",
    looksFinished: false,
    stopped: false,
    openItems: [],
    basedOnSeq: 2,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...extra,
  };
}

function row(agentId: string, extra: Partial<SessionStateRow> = {}): SessionStateRow {
  return {
    agentId,
    title: `T ${agentId}`,
    provider: "claude",
    model: null,
    workspaceId: "wks_a",
    workspaceTitle: "OAuth",
    projectName: "DeepCycle",
    folder: "DeepCycle Tasks",
    folderId: "f1",
    pinned: false,
    background: false,
    state: "parked",
    yourMoveText: null,
    card: card(),
    chief: false,
    lastUserMessageAt: "2026-11-18T07:00:00.000Z",
    lastActivityAt: "2026-11-18T07:30:00.000Z",
    link: `[T ${agentId}](paseo://x/${agentId})`,
    url: null,
    workspaceLink: null,
    ...extra,
  };
}

const snapshot = (extra: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  brief: {
    headline: "One reply waits on you.",
    since: "Since last night: nothing broke.",
    queue: [],
    checkOn: [],
    superseded: ["rep"],
    generatedAt: "2026-11-18T08:20:00.000Z",
  },
  state: EMPTY_HOME_STATE,
  closedToday: 2,
  briefRunning: false,
  updatedAt: "2026-11-18T08:30:00.000Z",
  ...extra,
});

describe("buildHomeGet (what Home shows, for Chief)", () => {
  const rows = [
    row("wait"),
    row("quiet", { card: card({ waitingOn: "nobody", kind: "none", nextStep: null }), lastUserMessageAt: null }),
    row("run", { state: "working", lastUserMessageAt: null }),
    row("crash", { state: "stopped", card: null }),
    row("rep", { card: card({ looksFinished: true }) }),
    row("fresh", { card: null }),
  ];

  it("reads like the screen: headline, tally, groups, every session once", () => {
    const out = buildHomeGet({ rows, snapshot: snapshot(), now: NOW });
    expect(out.headline).toBe("One reply waits on you.");
    expect(out.closedToday).toBe(2);
    expect(out.tally).toMatchObject({ open: 6, waiting: 1, running: 1, stopped: 1, toCheck: 3, gap: 0 });
    expect(out.queue.now.map((i) => i.agentId)).toEqual(["wait"]);
    expect(out.queue.now[0]).toMatchObject({
      title: "Google OAuth secret for Riajul",
      nextStep: "Tell Riajul yes",
      workspace: "OAuth",
      folder: "DeepCycle Tasks",
    });
    expect(out.tidy.stopped.map((i) => i.agentId)).toEqual(["crash"]);
    expect(out.tidy.superseded.map((i) => i.agentId)).toEqual(["rep"]);
    expect(out.checkOn.map((i) => i.agentId).sort()).toEqual(["fresh", "quiet"]);
    expect(out.checkOn.find((i) => i.agentId === "fresh")?.reading).toBe(true);
    expect(out.recentlyWorkedOn.map((i) => i.agentId)).toContain("wait");
    expect(out.running.map((i) => i.agentId)).toEqual(["run"]);
  });

  it("leaves the Chief agent out: it has its own bar", () => {
    const out = buildHomeGet({ rows: [row("a"), row("chief", { chief: true })], snapshot: snapshot(), now: NOW });
    expect(out.tally.open).toBe(1);
    expect(out.queue.now.map((i) => i.agentId)).toEqual(["a"]);
  });

  it("includes a Chief layout and keeps the rest of the queue reachable", () => {
    const out = buildHomeGet({
      rows: [row("a"), row("b")],
      snapshot: snapshot({
        state: {
          ...EMPTY_HOME_STATE,
          chiefLayout: {
            title: "Your 1",
            reason: "because you asked",
            createdAt: "2026-11-18T08:40:00.000Z",
            groups: [{ label: "First", items: [{ agentId: "b", line: "Go" }] }],
          },
        },
      }),
      now: NOW,
    });
    expect(out.chiefLayout?.groups[0].items[0]).toMatchObject({ agentId: "b", line: "Go" });
    expect(out.chiefLayout?.restOfQueue.map((i) => i.agentId)).toEqual(["a"]);
  });
});

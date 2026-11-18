import { describe, expect, it } from "vitest";

import {
  EMPTY_HOME_STATE,
  HOME_KEEP_DAYS,
  buildHomeView,
  cardWaitsOnHim,
  computeHomeTally,
  normalizeHomeLayout,
  resolveSnoozeUntil,
  type HomeBrief,
  type HomeSessionInput,
  type HomeState,
} from "./home.js";
import type { HomeCard } from "./topic-trail.js";

const NOW = Date.parse("2026-11-18T08:30:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function card(extra: Partial<HomeCard> = {}): HomeCard {
  return {
    what: "Some work",
    status: "Waiting.",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Decide this",
    urgency: "today",
    importance: "medium",
    why: "A reason",
    looksFinished: false,
    stopped: false,
    openItems: [],
    basedOnSeq: 1,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...extra,
  };
}

function session(id: string, extra: Partial<HomeSessionInput> = {}): HomeSessionInput {
  return {
    id,
    title: `Title ${id}`,
    state: "parked",
    card: card(),
    lastActivityAt: NOW - HOUR,
    folder: "DeepCycle",
    workspace: "OAuth",
    ...extra,
  };
}

function brief(extra: Partial<HomeBrief> = {}): HomeBrief {
  return {
    headline: "Two replies wait on you.",
    since: null,
    queue: [],
    checkOn: [],
    superseded: [],
    generatedAt: "2026-11-18T08:31:00.000Z",
    ...extra,
  };
}

const ids = (entries: { session: HomeSessionInput }[]) => entries.map((entry) => entry.session.id);

describe("cardWaitsOnHim", () => {
  it("is true only when he must act and it is not already done", () => {
    expect(cardWaitsOnHim(card())).toBe(true);
    expect(cardWaitsOnHim(card({ waitingOn: "Riajul" }))).toBe(false);
    expect(cardWaitsOnHim(card({ waitingOn: " Nazmul " }))).toBe(true);
    expect(cardWaitsOnHim(card({ kind: "none" }))).toBe(false);
    expect(cardWaitsOnHim(card({ looksFinished: true }))).toBe(false);
    expect(cardWaitsOnHim(null)).toBe(false);
  });
});

describe("buildHomeView grouping", () => {
  it("puts every session in exactly one group and the tally adds up (gap 0)", () => {
    const sessions: HomeSessionInput[] = [
      session("wait-now", { card: card({ urgency: "now" }) }),
      session("wait-today"),
      session("wait-later", { card: card({ urgency: "whenever" }) }),
      session("running", { state: "working" }),
      session("quiet", { card: card({ waitingOn: "nobody", kind: "none" }) }),
      session("finished", { card: card({ looksFinished: true }) }),
      session("stopped-done", { state: "stopped", card: card({ looksFinished: true }) }),
      session("no-card", { card: null }),
      session("permission", { state: "needs_you", card: null }),
      session("snoozed"),
      session("kept", { card: card({ waitingOn: "nobody", kind: "none" }) }),
      session("repeat", { card: card({ looksFinished: true }) }),
    ];
    const state: HomeState = {
      ...EMPTY_HOME_STATE,
      snoozed: { snoozed: new Date(NOW + 3 * HOUR).toISOString() },
      kept: { kept: new Date(NOW + HOME_KEEP_DAYS * DAY).toISOString() },
    };
    const view = buildHomeView({ sessions, brief: brief({ superseded: ["repeat"] }), state, now: NOW });

    expect(ids(view.queue.now)).toEqual(["permission", "wait-now"]);
    expect(ids(view.queue.today)).toEqual(["wait-today"]);
    expect(ids(view.queue.later)).toEqual(["wait-later"]);
    expect(ids(view.snoozed)).toEqual(["snoozed"]);
    expect(ids(view.running)).toEqual(["running"]);
    expect(ids(view.kept)).toEqual(["kept"]);
    expect(ids(view.tidy.stopped)).toEqual(["stopped-done"]);
    expect(ids(view.tidy.superseded)).toEqual(["repeat"]);
    expect(ids(view.checkOn).sort()).toEqual(["finished", "no-card", "quiet"]);

    const all = [
      ...view.queue.now,
      ...view.queue.today,
      ...view.queue.later,
      ...view.snoozed,
      ...view.running,
      ...view.checkOn,
      ...view.kept,
      ...view.tidy.stopped,
      ...view.tidy.superseded,
    ];
    expect(all).toHaveLength(sessions.length);
    expect(new Set(ids(all)).size).toBe(sessions.length);
    expect(view.tally).toEqual({
      open: 12,
      waiting: 5,
      running: 1,
      stopped: 1,
      toCheck: 5,
      gap: 0,
    });
  });

  it("a session with no card is listed, marked reading, never hidden", () => {
    const view = buildHomeView({
      sessions: [session("fresh", { card: null, title: "Brand voice" })],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(view.checkOn).toHaveLength(1);
    expect(view.checkOn[0].reading).toBe(true);
    expect(view.checkOn[0].title).toBe("Brand voice");
    expect(view.tally.gap).toBe(0);
  });

  it("reports a gap when the groups hold fewer sessions than are open", () => {
    const view = buildHomeView({
      sessions: [session("a"), session("b", { state: "working" }), session("c", { card: null })],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(view.tally.gap).toBe(0);
    // Drop one session out of a group, as a bug would: the tally must say so, not hide it.
    const broken = computeHomeTally(3, { ...view, running: [] });
    expect(broken.gap).toBe(1);
    expect(broken.running).toBe(0);
    // And an open count above what was grouped (a session the screen never received a row for).
    expect(computeHomeTally(5, view).gap).toBe(2);
  });

  it("a stopped session that still waits on him stays in the queue", () => {
    const view = buildHomeView({
      sessions: [
        session("resume", {
          state: "stopped",
          card: card({ stopped: true, nextStep: "Send resume", urgency: "today", importance: "high" }),
        }),
      ],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.queue.today)).toEqual(["resume"]);
    expect(view.tidy.stopped).toHaveLength(0);
  });

  it("a card that says stopped with nothing for him goes to Tidy", () => {
    const view = buildHomeView({
      sessions: [session("cut", { card: card({ stopped: true, waitingOn: "agent", kind: "none" }) })],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.tidy.stopped)).toEqual(["cut"]);
  });

  it("someone else owing work is not his queue", () => {
    const view = buildHomeView({
      sessions: [session("riajul", { card: card({ waitingOn: "Riajul" }) })],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.checkOn)).toEqual(["riajul"]);
  });
});

describe("buildHomeView ordering and the brief", () => {
  it("the brief's group wins over the card's urgency, and its order wins inside a group", () => {
    const sessions = [
      session("a", { card: card({ urgency: "whenever" }) }),
      session("b", { card: card({ urgency: "now", importance: "high" }) }),
      session("c", { card: card({ urgency: "now", importance: "low" }) }),
    ];
    const view = buildHomeView({
      sessions,
      brief: brief({
        queue: [
          { id: "a", group: "now" },
          { id: "c", group: "now" },
        ],
      }),
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    // a and c are in the brief (group now, brief order a then c); b is not, so its card decides
    // (now) and it sorts after the brief's picks.
    expect(ids(view.queue.now)).toEqual(["a", "c", "b"]);
    expect(view.queue.later).toHaveLength(0);
  });

  it("without a brief the rule orders: urgency, importance, then newest", () => {
    const view = buildHomeView({
      sessions: [
        session("low", { card: card({ urgency: "today", importance: "low" }) }),
        session("old-high", { card: card({ urgency: "today", importance: "high" }), lastActivityAt: NOW - DAY }),
        session("new-high", { card: card({ urgency: "today", importance: "high" }), lastActivityAt: NOW - HOUR }),
      ],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.queue.today)).toEqual(["new-high", "old-high", "low"]);
  });

  it("Check on these follows the brief's order, then importance", () => {
    const quiet = (importance: HomeCard["importance"]) =>
      card({ waitingOn: "nobody", kind: "none", importance });
    const view = buildHomeView({
      sessions: [
        session("x", { card: quiet("low") }),
        session("y", { card: quiet("high") }),
        session("z", { card: quiet("medium") }),
      ],
      brief: brief({ checkOn: ["z"] }),
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.checkOn)).toEqual(["z", "y", "x"]);
  });

  it("uses agentId, not the view key, to read the brief", () => {
    const view = buildHomeView({
      sessions: [{ ...session("host1:a"), agentId: "a" }, { ...session("host1:b"), agentId: "b" }],
      brief: brief({ queue: [{ id: "b", group: "now" }] }),
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.queue.now)).toEqual(["host1:b"]);
  });
});

describe("entry title", () => {
  it("is the card's theme title, else what it is about, else the session title", () => {
    const view = buildHomeView({
      sessions: [
        session("a", { card: card({ title: "Google OAuth secret for Riajul", what: "OAuth" }), title: "Riyajul asking me this. Do we" }),
        session("b", { card: card({ what: "Brand voice file" }), title: "please use easy language." }),
        session("c", { card: null, title: "Chief setup" }),
      ],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    const titles = Object.fromEntries(
      [...view.queue.today, ...view.checkOn].map((entry) => [entry.session.id, entry.title]),
    );
    expect(titles).toEqual({
      a: "Google OAuth secret for Riajul",
      b: "Brand voice file",
      c: "Chief setup",
    });
  });
});

describe("Recently worked on", () => {
  it("lists the 10 sessions he last wrote to, newest first, whatever their importance; recentAll has the rest", () => {
    const sessions = Array.from({ length: 13 }, (_, index) =>
      session(`s${index}`, {
        lastUserMessageAt: NOW - index * HOUR,
        card: card({ importance: index % 2 ? "low" : "high", waitingOn: "nobody", kind: "none" }),
      }),
    );
    sessions.push(session("never", { lastUserMessageAt: 0 }), session("unset"));
    const view = buildHomeView({ sessions, brief: null, state: EMPTY_HOME_STATE, now: NOW });
    expect(ids(view.recent)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`));
    expect(ids(view.recentAll)).toHaveLength(13);
    expect(ids(view.recentAll).slice(0, 10)).toEqual(ids(view.recent));
  });

  it("is an overlay: a session may be in recent and in the queue, and the tally still adds up", () => {
    const view = buildHomeView({
      sessions: [session("a", { lastUserMessageAt: NOW - HOUR })],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.recent)).toEqual(["a"]);
    expect(ids(view.queue.today)).toEqual(["a"]);
    expect(view.tally).toMatchObject({ open: 1, gap: 0 });
  });

  it("Running now omits sessions already in recent", () => {
    const view = buildHomeView({
      sessions: [
        session("r1", { state: "working", lastUserMessageAt: NOW - HOUR }),
        session("r2", { state: "working" }),
      ],
      brief: null,
      state: EMPTY_HOME_STATE,
      now: NOW,
    });
    expect(ids(view.running).sort()).toEqual(["r1", "r2"]);
    expect(ids(view.runningElsewhere)).toEqual(["r2"]);
  });
});

describe("snooze and keep", () => {
  it("a snooze in the past returns the session to the queue", () => {
    const view = buildHomeView({
      sessions: [session("a")],
      brief: null,
      state: { ...EMPTY_HOME_STATE, snoozed: { a: new Date(NOW - 1000).toISOString() } },
      now: NOW,
    });
    expect(ids(view.queue.today)).toEqual(["a"]);
    expect(view.snoozed).toHaveLength(0);
  });

  it("keeps are released when the session moves again", () => {
    const keptUntil = new Date(NOW + 3 * DAY).toISOString();
    const keptAt = NOW + 3 * DAY - HOME_KEEP_DAYS * DAY;
    const quiet = card({ waitingOn: "nobody", kind: "none" });
    const view = buildHomeView({
      sessions: [
        session("still", { card: quiet, lastActivityAt: keptAt - HOUR }),
        session("moved", { card: quiet, lastActivityAt: keptAt + HOUR }),
      ],
      brief: null,
      state: { ...EMPTY_HOME_STATE, kept: { still: keptUntil, moved: keptUntil } },
      now: NOW,
    });
    expect(ids(view.kept)).toEqual(["still"]);
    expect(ids(view.checkOn)).toEqual(["moved"]);
  });
});

describe("Chief layout", () => {
  const layout = {
    title: "Your 3 for today",
    reason: "because you asked",
    createdAt: "2026-11-18T08:40:00.000Z",
    groups: [
      { label: "First", items: [{ agentId: "b", line: "Do this first" }, { agentId: "gone" }] },
      { label: "Empty", items: [{ agentId: "missing" }] },
    ],
  };

  it("resolves ids, drops unknown ones and empty groups, and keeps the rest of the queue reachable", () => {
    const view = buildHomeView({
      sessions: [session("a"), session("b"), session("q", { card: card({ waitingOn: "nobody", kind: "none" }) })],
      brief: null,
      state: { ...EMPTY_HOME_STATE, chiefLayout: layout },
      now: NOW,
    });
    expect(view.layout?.groups.map((group) => group.label)).toEqual(["First"]);
    expect(view.layout?.groups[0].items[0].line).toBe("Do this first");
    expect(ids(view.layout?.restOfQueue ?? [])).toEqual(["a"]);
    // The layout is an overlay: the groups underneath still hold every session.
    expect(view.tally.gap).toBe(0);
  });

  it("a layout with nothing left to show is no layout", () => {
    const view = buildHomeView({
      sessions: [session("a")],
      brief: null,
      state: { ...EMPTY_HOME_STATE, chiefLayout: layout },
      now: NOW,
    });
    expect(view.layout).toBeNull();
  });

  it("normalizeHomeLayout bounds the layout and removes duplicates", () => {
    const many = {
      ...layout,
      groups: [
        {
          label: "  Big  ",
          items: Array.from({ length: 20 }, (_, index) => ({ agentId: `s${index % 15}` })),
        },
      ],
    };
    const normalized = normalizeHomeLayout(many);
    expect(normalized.groups[0].label).toBe("Big");
    expect(normalized.groups[0].items).toHaveLength(12);
    expect(new Set(normalized.groups[0].items.map((item) => item.agentId)).size).toBe(12);
  });
});

describe("resolveSnoozeUntil", () => {
  const now = new Date(2026, 10, 18, 14, 20, 0); // Wed 18 Nov 2026, 14:20 local

  it("3 hours is 3 hours", () => {
    expect(resolveSnoozeUntil("3h", now).getTime() - now.getTime()).toBe(3 * HOUR);
  });

  it("tomorrow is 09:00 the next local day", () => {
    const until = resolveSnoozeUntil("tomorrow", now);
    expect([until.getDate(), until.getHours(), until.getMinutes()]).toEqual([19, 9, 0]);
  });

  it("next week is the coming Monday 09:00, and from a Monday it is the Monday after", () => {
    const wed = resolveSnoozeUntil("nextweek", now);
    expect([wed.getDay(), wed.getDate(), wed.getHours()]).toEqual([1, 23, 9]);
    const monday = resolveSnoozeUntil("nextweek", new Date(2026, 10, 23, 8, 0, 0));
    expect([monday.getDay(), monday.getDate()]).toEqual([1, 30]);
  });
});

import { describe, expect, it } from "vitest";
import { buildHomeView, type HomeLayout } from "@getpaseo/protocol/home";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import type { HomeSession } from "./model";
import {
  buildQueueModel,
  clipReplyLine,
  computeTallyBar,
  describeItem,
  describeSnoozeBack,
  describeTidy,
  dotKindFor,
  fallbackHeadline,
  formatClock,
  itemHasActions,
  priorityGroupOf,
  QUEUE_SORTS,
  splitCheckOn,
  visibleQueueItems,
} from "./view-model";

const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();

function card(over: Partial<HomeCard> = {}): HomeCard {
  return {
    what: "OAuth secret",
    status: "Answer is ready",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Tell Riajul yes",
    urgency: "now",
    importance: "high",
    why: "Riajul is waiting",
    looksFinished: false,
    stopped: false,
    openItems: [],
    basedOnSeq: 1,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...over,
  };
}

function session(id: string, over: Partial<HomeSession> = {}): HomeSession {
  return {
    id,
    agentId: id,
    serverId: "s1",
    workspaceId: "w1",
    title: `Raw title ${id}`,
    state: "your_move",
    card: card(),
    lastActivityAt: NOW - 60_000,
    folder: "Folder",
    workspace: "Workspace",
    ...over,
  };
}

const EMPTY_STATE = { snoozed: {}, kept: {}, chiefLayout: null };

function viewOf(sessions: HomeSession[], chiefLayout: HomeLayout | null = null) {
  return buildHomeView({
    sessions,
    brief: null,
    state: { ...EMPTY_STATE, chiefLayout },
    now: NOW,
  });
}

const waitingNow = (id: string, over: Partial<HomeCard> = {}) =>
  session(id, { card: card({ urgency: "now", ...over }) });
const waitingToday = (id: string) => session(id, { card: card({ urgency: "today" }) });
const waitingLater = (id: string) => session(id, { card: card({ urgency: "whenever" }) });

describe("computeTallyBar", () => {
  it("splits the bar into waiting, running and the rest", () => {
    const bar = computeTallyBar({
      open: 100,
      waiting: 23,
      running: 2,
      stopped: 0,
      toCheck: 75,
      gap: 0,
    });
    expect(bar.waiting).toBeCloseTo(23);
    expect(bar.running).toBeCloseTo(2);
    expect(bar.rest).toBeCloseTo(75);
    expect(bar.waiting + bar.running + bar.rest).toBeCloseTo(100);
  });

  it("is empty with no sessions and never exceeds 100", () => {
    expect(
      computeTallyBar({ open: 0, waiting: 0, running: 0, stopped: 0, toCheck: 0, gap: 0 }),
    ).toEqual({
      waiting: 0,
      running: 0,
      rest: 0,
    });
    const over = computeTallyBar({
      open: 4,
      waiting: 4,
      running: 3,
      stopped: 0,
      toCheck: 0,
      gap: 0,
    });
    expect(over.waiting + over.running + over.rest).toBeLessThanOrEqual(100.0001);
  });
});

describe("fallbackHeadline", () => {
  const tally = (over: Partial<Parameters<typeof fallbackHeadline>[0]>) => ({
    open: 5,
    waiting: 0,
    running: 0,
    stopped: 0,
    toCheck: 0,
    gap: 0,
    ...over,
  });

  it("says what the tally says while there is no brief", () => {
    expect(fallbackHeadline(tally({ open: 0 }))).toEqual({ key: "empty", count: 0 });
    expect(fallbackHeadline(tally({ open: 5, waiting: 0 }))).toEqual({ key: "clear", count: 5 });
    expect(fallbackHeadline(tally({ open: 5, waiting: 3 }))).toEqual({ key: "waiting", count: 3 });
  });
});

describe("times", () => {
  it("formatClock is local HH:MM and null for nothing", () => {
    expect(formatClock(new Date(2026, 10, 18, 8, 5).toISOString())).toBe("08:05");
    expect(formatClock(null)).toBeNull();
    expect(formatClock("not a date")).toBeNull();
  });

  it("describeSnoozeBack says today, tomorrow or a date", () => {
    const now = new Date(2026, 10, 18, 12, 0);
    expect(describeSnoozeBack(new Date(2026, 10, 18, 15, 0).getTime(), now)).toEqual({
      kind: "today",
      time: "15:00",
    });
    expect(describeSnoozeBack(new Date(2026, 10, 19, 9, 0).getTime(), now)).toEqual({
      kind: "tomorrow",
      time: "09:00",
    });
    const later = describeSnoozeBack(new Date(2026, 10, 23, 9, 0).getTime(), now);
    expect(later.kind).toBe("date");
    expect(later.time).toBe("09:00");
  });
});

const lowOf = (id: string, over: Partial<HomeCard> = {}, extra: Partial<HomeSession> = {}) =>
  session(id, { card: card({ importance: "low", ...over }), ...extra });

describe("buildQueueModel: priority (the default sort)", () => {
  const mixed = () =>
    viewOf([
      lowOf("urgent-less", { urgency: "now" }),
      waitingLater("important-only"),
      lowOf("neither-1", { urgency: "whenever" }),
      waitingNow("both-1"),
      waitingToday("both-2"),
      lowOf("neither-2", { urgency: "week" }),
    ]);

  it("splits by urgency now|today and importance high, in the four named groups", () => {
    const model = buildQueueModel(mixed());
    expect(model.sort).toBe("priority");
    expect(
      model.blocks.map((b) => [b.labelKey, b.items.map((i) => i.entry.session.id)]),
    ).toEqual([
      ["urgentImportant", ["both-1", "both-2"]],
      ["urgentLess", ["urgent-less"]],
      ["importantNotUrgent", ["important-only"]],
    ]);
    expect(model.collapsed?.items.map((i) => i.entry.session.id)).toEqual(["neither-2", "neither-1"]);
  });

  it("tints the first group strong, the second light, the rest none; numbers run straight on", () => {
    const model = buildQueueModel(mixed());
    expect(model.blocks.map((b) => b.tint)).toEqual(["now", "today", "none"]);
    const numbers = [...model.blocks.flatMap((b) => b.items), ...(model.collapsed?.items ?? [])];
    expect(numbers.map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("hides empty groups, so the first group shown is the strongest whatever it is", () => {
    const model = buildQueueModel(viewOf([waitingLater("a"), lowOf("b", { urgency: "week" })]));
    expect(model.blocks.map((b) => [b.labelKey, b.tint])).toEqual([["importantNotUrgent", "now"]]);
    expect(model.collapsed?.items.map((i) => i.entry.session.id)).toEqual(["b"]);
  });

  it("a pending permission is urgent; a session with no card is Neither", () => {
    const model = buildQueueModel(viewOf([session("perm", { state: "needs_you", card: null })]));
    expect(model.blocks[0].labelKey).toBe("urgentLess");
    expect(priorityGroupOf(session("x", { card: null, state: "your_move" }))).toBe("neither");
  });

  it("an empty queue is empty", () => {
    const model = buildQueueModel(viewOf([session("done", { card: card({ kind: "none" }) })]));
    expect(model.blocks).toEqual([]);
    expect(model.collapsed).toBeNull();
  });

  it("keys 1-9 reach only what is on screen: the collapsed group joins when opened", () => {
    const model = buildQueueModel(
      viewOf([waitingNow("n1"), waitingToday("t1"), lowOf("l1", { urgency: "whenever" })]),
    );
    expect(visibleQueueItems(model, false).map((i) => i.number)).toEqual([1, 2]);
    expect(visibleQueueItems(model, true).map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it("every item of the normal queue has Later and Close", () => {
    const model = buildQueueModel(mixed(), "folder");
    for (const item of visibleQueueItems(model, true)) expect(itemHasActions(model, item)).toBe(true);
  });
});

describe("buildQueueModel: the other sorts", () => {
  const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;
  const sessions = (layout: HomeLayout | null = null) =>
    viewOf([
      session("old", { lastActivityAt: at(300), card: card({ urgency: "today" }), folder: "B" }),
      session("mid", { lastActivityAt: at(60), card: card({ urgency: "whenever" }), folder: null }),
      session("fresh", { lastActivityAt: at(1), folder: "A" }),
      session("fresh2", { lastActivityAt: at(2), folder: "B", card: card({ urgency: "week" }) }),
    ], layout);
  const ids = (model: ReturnType<typeof buildQueueModel>) =>
    model.blocks.flatMap((b) => b.items.map((i) => i.entry.session.id));

  it("waiting longest: one flat list, oldest activity first, nothing collapsed", () => {
    const model = buildQueueModel(sessions(), "waiting");
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0].tint).toBe("none");
    expect(ids(model)).toEqual(["old", "mid", "fresh2", "fresh"]);
    expect(model.collapsed).toBeNull();
    expect(model.blocks[0].items.map((i) => i.number)).toEqual([1, 2, 3, 4]);
  });

  it("recent: one flat list, newest activity first", () => {
    expect(ids(buildQueueModel(sessions(), "recent"))).toEqual(["fresh", "fresh2", "mid", "old"]);
  });

  it("folder: a block per folder by best rank, rank order inside, Unfiled last", () => {
    const model = buildQueueModel(sessions(), "folder");
    expect(model.blocks.map((b) => [b.label ?? b.labelKey, ids({ ...model, blocks: [b] })])).toEqual([
      ["A", ["fresh"]],
      ["B", ["old", "fresh2"]],
      ["unfiled", ["mid"]],
    ]);
    expect(model.blocks.every((b) => b.tint === "none")).toBe(true);
  });

  it("recomputes from the view every time: the same sessions in a new order give a new order", () => {
    const a = buildQueueModel(sessions(), "waiting");
    const touched = viewOf([
      session("old", { lastActivityAt: at(0.5), card: card({ urgency: "today" }) }),
      session("mid", { lastActivityAt: at(60), card: card({ urgency: "whenever" }) }),
    ]);
    expect(ids(a)[0]).toBe("old");
    expect(ids(buildQueueModel(touched, "waiting"))).toEqual(["mid", "old"]);
  });

  it("a Chief layout wins over every sort", () => {
    const layout: HomeLayout = {
      title: "t",
      reason: "r",
      createdAt: "2026-11-18T08:40:00.000Z",
      groups: [{ label: "G", items: [{ agentId: "old" }] }],
    };
    for (const sort of QUEUE_SORTS) {
      expect(buildQueueModel(sessions(layout), sort).mode).toBe("layout");
    }
  });
});

describe("buildQueueModel: a Chief layout replaces the queue", () => {
  const layout: HomeLayout = {
    title: "Your 4 for today",
    reason: "because you asked",
    createdAt: "2026-11-18T08:40:00.000Z",
    groups: [
      { label: "Most urgent", items: [{ agentId: "a", line: "Public right now" }] },
      { label: "Next", items: [{ agentId: "b" }] },
      { label: "Then", items: [{ agentId: "c" }] },
    ],
  };
  const sessions = [waitingNow("a"), waitingToday("b"), waitingToday("c"), waitingLater("d")];

  it("uses Chief's groups: first strongest, second faint, the rest plain, with its lines", () => {
    const model = buildQueueModel(viewOf(sessions, layout));
    expect(model.mode).toBe("layout");
    expect(model.layout).toEqual({
      title: "Your 4 for today",
      reason: "because you asked",
      createdAt: "2026-11-18T08:40:00.000Z",
    });
    expect(model.blocks.map((b) => [b.label, b.tint])).toEqual([
      ["Most urgent", "now"],
      ["Next", "today"],
      ["Then", "none"],
    ]);
    expect(model.blocks[0].items[0].line).toBe("Public right now");
    expect(model.blocks[1].items[0].line).toBeNull();
  });

  it("queue sessions the layout leaves out wait collapsed, numbered after, with Later and Close", () => {
    const model = buildQueueModel(viewOf(sessions, layout));
    expect(model.collapsed?.items.map((i) => [i.entry.session.id, i.number])).toEqual([["d", 4]]);
    const items = visibleQueueItems(model, true);
    expect(itemHasActions(model, items[0])).toBe(false);
    expect(itemHasActions(model, items[3])).toBe(true);
  });

  it("a layout naming only sessions that no longer exist falls back to the normal queue", () => {
    const gone: HomeLayout = { ...layout, groups: [{ label: "x", items: [{ agentId: "zzz" }] }] };
    expect(buildQueueModel(viewOf(sessions, gone)).mode).toBe("queue");
  });
});

describe("describeItem", () => {
  const entryOf = (s: HomeSession) => viewOf([s]).queue.now[0] ?? viewOf([s]).checkOn[0];

  it("the bold name is entry.title (card title, else what), never the raw session title", () => {
    const withTitle = entryOf(waitingNow("a", { title: "Google OAuth secret for Riajul" }));
    expect(describeItem(withTitle, { withNextStep: true, withWhy: true }).name).toBe(
      "Google OAuth secret for Riajul",
    );
    const withoutTitle = entryOf(waitingNow("b"));
    expect(describeItem(withoutTitle, { withNextStep: true, withWhy: true }).name).toBe(
      "OAuth secret",
    );
  });

  it("a queue item shows the next step, the status, then why", () => {
    const text = describeItem(entryOf(waitingNow("a")), { withNextStep: true, withWhy: true });
    expect(text).toEqual({
      name: "OAuth secret",
      nextStep: "Tell Riajul yes",
      status: "Answer is ready",
      why: "Riajul is waiting",
    });
  });

  it("other rows have no next step and no why", () => {
    const text = describeItem(entryOf(waitingNow("a")), { withNextStep: false, withWhy: false });
    expect(text.nextStep).toBeNull();
    expect(text.why).toBeNull();
    expect(text.status).toBe("Answer is ready");
  });

  it("Chief's one line replaces the card's why", () => {
    const text = describeItem(entryOf(waitingNow("a")), {
      withNextStep: true,
      withWhy: true,
      layoutLine: "Public on DeepCycle's account right now",
    });
    expect(text.why).toBe("Public on DeepCycle's account right now");
  });

  it("leaves out a line that repeats the name or another line", () => {
    const text = describeItem(
      entryOf(
        waitingNow("a", {
          what: "Reply to Riajul",
          nextStep: "Reply to Riajul",
          status: "reply to riajul",
        }),
      ),
      { withNextStep: true, withWhy: true },
    );
    expect(text.nextStep).toBeNull();
    expect(text.status).toBeNull();
    expect(text.why).toBe("Riajul is waiting");
  });

  it("a session with no card yet is named by its session title and has no lines", () => {
    const text = describeItem(entryOf(session("x", { card: null, state: "parked" })), {
      withNextStep: true,
      withWhy: true,
    });
    expect(text).toEqual({ name: "Raw title x", nextStep: null, status: null, why: null });
  });
});

describe("Check on these and Tidy", () => {
  const quiet = (id: string) => session(id, { card: card({ waitingOn: "nobody", kind: "none" }) });

  it("shows the top 4, the rest are counted behind Sweep them", () => {
    const view = viewOf(Array.from({ length: 7 }, (_, i) => quiet(`q${i}`)));
    const { shown, more } = splitCheckOn(view.checkOn);
    expect(shown).toHaveLength(4);
    expect(more).toBe(3);
    expect(splitCheckOn(view.checkOn.slice(0, 2))).toMatchObject({ more: 0 });
  });

  it("Close them covers every stopped and every repeated session, once each", () => {
    const view = buildHomeView({
      sessions: [
        session("stopped1", { state: "stopped", card: null }),
        session("stopped2", { state: "stopped", card: null }),
        session("repeat1", { card: card({ waitingOn: "nobody", kind: "none" }) }),
      ],
      brief: {
        headline: "",
        since: null,
        queue: [],
        checkOn: [],
        superseded: ["repeat1"],
        generatedAt: "2026-11-18T08:00:00.000Z",
      },
      state: EMPTY_STATE,
      now: NOW,
    });
    const tidy = describeTidy(view);
    expect(tidy.stopped).toHaveLength(2);
    expect(tidy.superseded).toHaveLength(1);
    expect(tidy.all.map((e) => e.session.id).sort()).toEqual(["repeat1", "stopped1", "stopped2"]);
  });
});

describe("clipReplyLine", () => {
  it("takes the first non-empty line", () => {
    expect(clipReplyLine("\n\n  Closed 3 crashed sessions.\nSecond line")).toBe(
      "Closed 3 crashed sessions.",
    );
  });

  it("strips markdown marks that clutter a one-line preview", () => {
    expect(clipReplyLine("## Done")).toBe("Done");
    expect(clipReplyLine("- **Closed** 3 [sessions](paseo://x)")).toBe("Closed 3 sessions");
    expect(clipReplyLine("1. First thing")).toBe("First thing");
    expect(clipReplyLine("> quoted `code`")).toBe("quoted code");
  });

  it("skips a rule line and a bare marker", () => {
    expect(clipReplyLine("---\n\nReal text")).toBe("Real text");
  });

  it("clips a long line with an ellipsis and keeps a short one whole", () => {
    const long = "x".repeat(300);
    const clipped = clipReplyLine(long, 50) ?? "";
    expect(clipped.length).toBe(50);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipReplyLine("short", 50)).toBe("short");
  });

  it("is null for nothing", () => {
    expect(clipReplyLine(null)).toBeNull();
    expect(clipReplyLine("   \n \n")).toBeNull();
  });
});

describe("dotKindFor", () => {
  it("amber waits on him, blue runs, everything else is a ring: two colours at most", () => {
    expect(dotKindFor("working", false)).toBe("running");
    expect(dotKindFor("working", true)).toBe("running");
    expect(dotKindFor("needs_you", false)).toBe("waiting");
    expect(dotKindFor("your_move", true)).toBe("waiting");
    expect(dotKindFor("your_move", false)).toBe("ring");
    expect(dotKindFor("stopped", false)).toBe("ring");
    expect(dotKindFor("parked", false)).toBe("ring");
  });
});

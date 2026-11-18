import { describe, expect, it } from "vitest";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import {
  buildCardFacts,
  buildCardRules,
  cardIsCurrent,
  dropKeepAliveRows,
  isKeepAlivePrompt,
  mergeHomeCard,
  newestMessageSeq,
  type CardRow,
  type HomeCardModelResult,
} from "./home-card.js";

const NOW = new Date("2026-11-18T09:00:00.000Z");

function model(extra: Partial<HomeCardModelResult> = {}): HomeCardModelResult {
  return {
    title: "Google OAuth secret for Riajul.",
    what: "OAuth for DeepCycle",
    status: "The client secret is saved.",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Tell Riajul yes",
    urgency: "now",
    importance: "high",
    why: "Riajul is waiting on you.",
    looksFinished: false,
    stopped: false,
    ...extra,
  };
}

function prev(extra: Partial<HomeCard> = {}): HomeCard {
  return {
    title: "OAuth",
    what: "x",
    status: "x",
    waitingOn: "nazmul",
    kind: "task",
    nextStep: "x",
    urgency: "today",
    importance: "medium",
    why: "x",
    looksFinished: false,
    stopped: false,
    openItems: ["Test the secret", "Tell Riajul"],
    basedOnSeq: 4,
    updatedAt: "2026-11-17T00:00:00.000Z",
    ...extra,
  };
}

const row = (seq: number, type: string, text: string): CardRow => ({
  seq,
  timestamp: `2026-11-17T10:0${seq}:00.000Z`,
  item: { type, text },
});

describe("dropKeepAliveRows", () => {
  it("drops the cache-warm ping and its ok reply, keeps real messages around them", () => {
    const rows = [
      row(1, "user_message", "price the meters"),
      row(2, "assistant_message", "Assign DEE-41?"),
      row(3, "user_message", "AFK for a bit, keeping you alive. Reply with 'ok' only."),
      row(4, "assistant_message", "ok"),
      row(5, "user_message", "AFK for a bit, keeping you alive. Reply with 'ok' only."),
      row(6, "assistant_message", "OK."),
      row(7, "user_message", "yes assign it"),
    ];
    expect(dropKeepAliveRows(rows).map((r) => r.seq)).toEqual([1, 2, 7]);
  });

  it("keeps an assistant message after a ping when it says more than ok", () => {
    const rows = [
      row(1, "user_message", "AFK for a bit, keeping you alive. Reply with 'ok' only."),
      row(2, "assistant_message", "ok, and also the build finished"),
    ];
    expect(dropKeepAliveRows(rows).map((r) => r.seq)).toEqual([2]);
  });

  it("recognises a custom ping that says it keeps the session alive", () => {
    expect(isKeepAlivePrompt("Still here? Just keeping you alive.")).toBe(true);
    expect(isKeepAlivePrompt("Please keep it alive for the demo")).toBe(false);
    expect(isKeepAlivePrompt(null)).toBe(false);
  });

  it("a session of only pings has no message left", () => {
    const rows = [
      row(1, "user_message", "AFK for a bit, keeping you alive. Reply with 'ok' only."),
      row(2, "assistant_message", "ok"),
    ];
    expect(newestMessageSeq(dropKeepAliveRows(rows))).toBe(0);
  });
});

describe("newestMessageSeq and cardIsCurrent", () => {
  it("is the highest seq of a real user or assistant message", () => {
    const rows = [
      row(1, "user_message", "a"),
      row(2, "tool_call", "x"),
      row(3, "assistant_message", "   "),
      row(4, "assistant_message", "b"),
    ];
    expect(newestMessageSeq(rows)).toBe(4);
  });

  it("is current only when nothing is newer than basedOnSeq", () => {
    expect(cardIsCurrent(prev({ basedOnSeq: 4 }), 4)).toBe(true);
    expect(cardIsCurrent(prev({ basedOnSeq: 4 }), 5)).toBe(false);
    expect(cardIsCurrent(null, 0)).toBe(false);
  });
});

describe("mergeHomeCard", () => {
  it("cleans and bounds the model answer", () => {
    const card = mergeHomeCard(
      null,
      model({ what: `  ${"word ".repeat(30)}`, nextStep: "Tell   Riajul\nyes" }),
      7,
      NOW,
    );
    expect(card.title).toBe("Google OAuth secret for Riajul");
    expect(card.what.length).toBeLessThanOrEqual(60);
    expect(card.what.endsWith("…")).toBe(true);
    expect(card.nextStep).toBe("Tell Riajul yes");
    expect(card.basedOnSeq).toBe(7);
    expect(card.updatedAt).toBe(NOW.toISOString());
  });

  it("a card with nothing for him carries no next step", () => {
    const card = mergeHomeCard(null, model({ kind: "none", nextStep: "Do not show me" }), 1, NOW);
    expect(card.nextStep).toBeNull();
    expect(mergeHomeCard(null, model({ nextStep: "   " }), 1, NOW).nextStep).toBeNull();
  });

  it("carries open items forward when the model does not mention them", () => {
    const card = mergeHomeCard(prev(), model(), 9, NOW);
    expect(card.openItems).toEqual(["Test the secret", "Tell Riajul"]);
  });

  it("takes the model's list as the truth when it returns one, even an empty one", () => {
    expect(mergeHomeCard(prev(), model({ openItems: [] }), 9, NOW).openItems).toEqual([]);
    expect(
      mergeHomeCard(prev(), model({ openItems: ["Only this", "only this", "Second", "Third", "Fourth"] }), 9, NOW)
        .openItems,
    ).toEqual(["Only this", "Second", "Third"]);
  });

  it("keeps the previous title when the model gives none, and the rename record", () => {
    const renamed = { from: "price the meters", to: "OAuth", at: "x" };
    const card = mergeHomeCard(prev({ renamed }), model({ title: "  . " }), 9, NOW);
    expect(card.title).toBe("OAuth");
    expect(card.renamed).toEqual(renamed);
  });

  it("an empty waitingOn becomes nobody", () => {
    expect(mergeHomeCard(null, model({ waitingOn: " " }), 1, NOW).waitingOn).toBe("nobody");
  });
});

describe("card prompt", () => {
  it("rules name the learning-review and quiet-3-days rules", () => {
    const rules = buildCardRules().join("\n");
    expect(rules).toContain("NEVER now or today");
    expect(rules).toContain("3 or more days");
    expect(rules).toContain("card.title");
  });

  it("facts carry the previous card as a checklist and the priorities file when present", () => {
    const facts = buildCardFacts({
      title: "price the meters",
      status: "idle",
      workspace: "Meters",
      folder: "DeepCycle",
      lastSpeaker: "assistant",
      quietDays: 4,
      previousCard: prev(),
      priorities: "LifeSpring is urgent this week.",
    }).join("\n");
    expect(facts).toContain("quietDays: 4");
    expect(facts).toContain("Test the secret");
    expect(facts).toContain("LifeSpring is urgent this week.");
    expect(facts).toContain("workspace: Meters in folder DeepCycle");
  });

  it("facts without priorities have no priorities section", () => {
    const facts = buildCardFacts({
      title: null,
      status: "idle",
      workspace: null,
      folder: null,
      lastSpeaker: null,
      quietDays: null,
      previousCard: null,
      priorities: "  ",
    }).join("\n");
    expect(facts).not.toContain("priorities");
    expect(facts).toContain("(untitled)");
  });
});

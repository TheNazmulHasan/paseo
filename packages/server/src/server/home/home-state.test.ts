import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_HOME_STATE, HOME_KEEP_DAYS, type HomeLayout } from "@getpaseo/protocol/home";
import { HomeStateStore, applyKeep, applyLayout, applySnooze, pruneHomeState } from "./home-state.js";

const NOW = Date.parse("2026-11-18T08:30:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("home state transforms", () => {
  it("snooze sets a return time, null or a past time clears it", () => {
    const until = new Date(NOW + 3 * HOUR).toISOString();
    const snoozed = applySnooze(EMPTY_HOME_STATE, "a", until, NOW);
    expect(snoozed.snoozed).toEqual({ a: until });
    expect(applySnooze(snoozed, "a", null, NOW).snoozed).toEqual({});
    expect(applySnooze(snoozed, "a", new Date(NOW - 1000).toISOString(), NOW).snoozed).toEqual({});
  });

  it("snooze rejects a time it cannot read", () => {
    expect(() => applySnooze(EMPTY_HOME_STATE, "a", "next tuesday-ish", NOW)).toThrow(/not a time/);
  });

  it("keep hides for HOME_KEEP_DAYS and keep false releases", () => {
    const kept = applyKeep(EMPTY_HOME_STATE, "a", true, NOW);
    expect(Date.parse(kept.kept.a) - NOW).toBe(HOME_KEEP_DAYS * DAY);
    expect(applyKeep(kept, "a", false, NOW).kept).toEqual({});
  });

  it("prune drops everything whose time has passed", () => {
    const state = {
      ...EMPTY_HOME_STATE,
      snoozed: { old: new Date(NOW - HOUR).toISOString(), fresh: new Date(NOW + HOUR).toISOString(), junk: "nope" },
      kept: { old: new Date(NOW - 1).toISOString() },
    };
    const pruned = pruneHomeState(state, NOW);
    expect(Object.keys(pruned.snoozed)).toEqual(["fresh"]);
    expect(pruned.kept).toEqual({});
  });

  it("a layout is normalized and null puts it back to normal", () => {
    const layout: HomeLayout = {
      title: "  Your 3  ",
      reason: "because you asked",
      createdAt: "2026-11-18T08:40:00.000Z",
      groups: [{ label: "First", items: [{ agentId: "a" }, { agentId: "a" }, { agentId: "b", line: " go " }] }],
    };
    const set = applyLayout(EMPTY_HOME_STATE, layout);
    expect(set.chiefLayout?.title).toBe("Your 3");
    expect(set.chiefLayout?.groups[0].items).toEqual([{ agentId: "a" }, { agentId: "b", line: "go" }]);
    expect(applyLayout(set, null).chiefLayout).toBeNull();
    expect(applyLayout(EMPTY_HOME_STATE, { ...layout, groups: [] }).chiefLayout).toBeNull();
  });
});

describe("HomeStateStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "home-state-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts empty with no file and survives a damaged one", async () => {
    const file = HomeStateStore.pathFor(dir);
    const store = new HomeStateStore(file, () => NOW);
    await store.load();
    expect(store.get()).toEqual(EMPTY_HOME_STATE);
    await store.snooze("a", null); // creates the folder
    writeFileSync(file, "{not json");
    const again = new HomeStateStore(file, () => NOW);
    await again.load();
    expect(again.get()).toEqual(EMPTY_HOME_STATE);
  });

  it("writes every change to disk and reads it back", async () => {
    const file = HomeStateStore.pathFor(dir);
    const store = new HomeStateStore(file, () => NOW);
    const until = new Date(NOW + 3 * HOUR).toISOString();
    await store.snooze("a", until);
    await store.keep("b", true);
    expect(JSON.parse(readFileSync(file, "utf8")).snoozed).toEqual({ a: until });
    const reloaded = new HomeStateStore(file, () => NOW);
    await reloaded.load();
    expect(reloaded.get().snoozed).toEqual({ a: until });
    expect(Object.keys(reloaded.get().kept)).toEqual(["b"]);
  });

  it("forgets a snooze whose time has passed when it is read", async () => {
    const file = HomeStateStore.pathFor(dir);
    let now = NOW;
    const store = new HomeStateStore(file, () => now);
    await store.snooze("a", new Date(NOW + HOUR).toISOString());
    expect(Object.keys(store.get().snoozed)).toEqual(["a"]);
    now = NOW + 2 * HOUR;
    expect(store.get().snoozed).toEqual({});
  });
});

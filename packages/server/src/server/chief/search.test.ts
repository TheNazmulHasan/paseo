import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPrivacyGuard, PRIVATE_TEXT_WITHHELD } from "./privacy.js";
import {
  makeSnippet,
  parseQuery,
  searchSessions,
  type SearchableSession,
  type SearchDeps,
} from "./search.js";
import { createTranscriptLocator } from "./transcripts.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "chief-search-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const ID4 = "44444444-4444-4444-8444-444444444444";

function claudeLine(role: "user" | "assistant", text: unknown, at: string, extra: object = {}): string {
  return JSON.stringify({
    type: role,
    timestamp: at,
    message: { role, content: typeof text === "string" && role === "user" ? text : [{ type: "text", text }] },
    ...extra,
  });
}

function writeClaude(id: string, lines: string[]): void {
  const dir = path.join(root, "claude", "projects", "-some-project");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.jsonl`), lines.join("\n") + "\n");
}

function writeCodex(id: string, lines: object[]): void {
  const dir = path.join(root, "codex", "sessions", "2026", "11", "16");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `rollout-2026-11-16T10-00-00-${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

function session(over: Partial<SearchableSession> & { agentId: string }): SearchableSession {
  return {
    title: null,
    workspaceId: "wks_a",
    cwds: [path.join(root, "project")],
    sessionIds: [],
    archived: false,
    lastActivityAt: "2026-11-10T00:00:00.000Z",
    ...over,
  };
}

function deps(sessions: SearchableSession[], over: Partial<SearchDeps> = {}): SearchDeps {
  return {
    sessions,
    locator: createTranscriptLocator({
      claudeConfigDirs: [path.join(root, "claude")],
      codexHomes: [path.join(root, "codex")],
    }),
    guard: createPrivacyGuard({ config: { searchPrivateText: false, privateWorkspaceIds: [] } }),
    config: { searchPrivateText: false, privateWorkspaceIds: [] },
    ...over,
  };
}

describe("parseQuery", () => {
  it("splits words and pulls out quoted phrases, lower-cased", () => {
    expect(parseQuery('Switchboard "Quota Check"  router')).toEqual({
      words: ["switchboard", "router"],
      phrases: ["quota check"],
    });
  });
});

describe("makeSnippet", () => {
  it("returns short messages whole and ~200 chars around the match for long ones", () => {
    expect(makeSnippet("a short one", parseQuery("short"))).toBe("a short one");
    const long = `${"x".repeat(500)} NEEDLE ${"y".repeat(500)}`;
    const snippet = makeSnippet(long, parseQuery("needle"));
    expect(snippet).toContain("NEEDLE");
    expect(snippet.replace(/…/g, "").length).toBe(200);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("searchSessions over Claude Code transcripts", () => {
  it("finds user and assistant text, not tool output, with date, who and a snippet", async () => {
    writeClaude(ID1, [
      claudeLine("user", "please fix the switchboard quota check", "2026-11-01T10:00:00.000Z"),
      claudeLine("assistant", "Looking at the router now.", "2026-11-01T10:00:05.000Z"),
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-01T10:00:09.000Z",
        message: { role: "user", content: [{ type: "tool_result", content: "SECRETTOOLWORD output" }] },
      }),
    ]);
    const outcome = await searchSessions(deps([session({ agentId: "a1", sessionIds: [ID1] })]), {
      query: "quota switchboard",
    });
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]).toMatchObject({
      who: "you",
      at: "2026-11-01T10:00:00.000Z",
      source: "claude",
      private: false,
    });
    expect(outcome.hits[0]!.snippet).toContain("switchboard quota check");

    const tool = await searchSessions(deps([session({ agentId: "a1", sessionIds: [ID1] })]), {
      query: "SECRETTOOLWORD",
    });
    expect(tool.hits).toHaveLength(0);
  });

  it("ANDs words inside one message, not across messages", async () => {
    writeClaude(ID1, [
      claudeLine("user", "alpha only here", "2026-11-01T10:00:00.000Z"),
      claudeLine("assistant", "beta only here", "2026-11-01T10:00:05.000Z"),
    ]);
    const outcome = await searchSessions(deps([session({ agentId: "a1", sessionIds: [ID1] })]), {
      query: "alpha beta",
    });
    expect(outcome.hits).toHaveLength(0);
  });

  it("quoted phrases must appear as written; matching is case-insensitive", async () => {
    writeClaude(ID1, [claudeLine("assistant", "The Account Switchboard is live", "2026-11-01T10:00:00.000Z")]);
    const base = deps([session({ agentId: "a1", sessionIds: [ID1] })]);
    expect((await searchSessions(base, { query: '"account switchboard"' })).hits).toHaveLength(1);
    expect((await searchSessions(base, { query: '"switchboard account"' })).hits).toHaveLength(0);
    expect((await searchSessions(base, { query: "ACCOUNT" })).hits[0]!.who).toBe("agent");
  });

  it("skips sidechain, meta and system-reminder text", async () => {
    writeClaude(ID1, [
      claudeLine("assistant", "sidechainword", "2026-11-01T10:00:00.000Z", { isSidechain: true }),
      claudeLine("user", "metaword", "2026-11-01T10:00:01.000Z", { isMeta: true }),
      claudeLine("user", "real text <system-reminder>reminderword</system-reminder>", "2026-11-01T10:00:02.000Z"),
    ]);
    const base = deps([session({ agentId: "a1", sessionIds: [ID1] })]);
    for (const word of ["sidechainword", "metaword", "reminderword"]) {
      expect((await searchSessions(base, { query: word })).hits).toHaveLength(0);
    }
    expect((await searchSessions(base, { query: "real" })).hits).toHaveLength(1);
  });

  it("since and until bound the message date; a bare until date includes that day", async () => {
    writeClaude(ID1, [
      claudeLine("user", "topic early", "2026-10-01T10:00:00.000Z"),
      claudeLine("user", "topic late", "2026-11-05T10:00:00.000Z"),
    ]);
    const base = deps([session({ agentId: "a1", sessionIds: [ID1] })]);
    const late = await searchSessions(base, { query: "topic", since: "2026-11-01" });
    expect(late.hits[0]!.at).toBe("2026-11-05T10:00:00.000Z");
    const early = await searchSessions(base, { query: "topic", until: "2026-10-01" });
    expect(early.hits[0]!.at).toBe("2026-10-01T10:00:00.000Z");
    const none = await searchSessions(base, { query: "topic", since: "2026-10-02", until: "2026-11-04" });
    expect(none.hits).toHaveLength(0);
  });

  it("stops at the limit and scans the given order (most recent first)", async () => {
    for (const [i, id] of [ID1, ID2, ID3].entries()) {
      writeClaude(id, [claudeLine("user", `common word ${i}`, "2026-11-01T10:00:00.000Z")]);
    }
    const outcome = await searchSessions(
      deps([
        session({ agentId: "new", sessionIds: [ID1] }),
        session({ agentId: "mid", sessionIds: [ID2] }),
        session({ agentId: "old", sessionIds: [ID3] }),
      ]),
      { query: "common", limit: 2 },
    );
    expect(outcome.hits.map((h) => h.session.agentId)).toEqual(["new", "mid"]);
    expect(outcome.sessionsScanned).toBe(2);
  });

  it("includeArchived defaults to true; false skips archived sessions; workspaceId filters", async () => {
    writeClaude(ID1, [claudeLine("user", "findme", "2026-11-01T10:00:00.000Z")]);
    writeClaude(ID2, [claudeLine("user", "findme", "2026-11-01T10:00:00.000Z")]);
    const sessions = [
      session({ agentId: "closed", sessionIds: [ID1], archived: true }),
      session({ agentId: "open", sessionIds: [ID2], workspaceId: "wks_b" }),
    ];
    expect((await searchSessions(deps(sessions), { query: "findme" })).hits).toHaveLength(2);
    expect(
      (await searchSessions(deps(sessions), { query: "findme", includeArchived: false })).hits.map(
        (h) => h.session.agentId,
      ),
    ).toEqual(["open"]);
    expect(
      (await searchSessions(deps(sessions), { query: "findme", workspaceId: "wks_b" })).hits.map(
        (h) => h.session.agentId,
      ),
    ).toEqual(["open"]);
  });
});

describe("searchSessions over other stores", () => {
  it("reads Codex rollouts and skips the injected AGENTS.md message", async () => {
    writeCodex(ID3, [
      { timestamp: "2026-11-16T10:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /x\ninjectedword" }] } },
      { timestamp: "2026-11-16T10:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "explain codexword" }] } },
      { timestamp: "2026-11-16T10:00:02.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "sure, codexword is..." }] } },
    ]);
    const base = deps([session({ agentId: "c1", sessionIds: [ID3] })]);
    expect((await searchSessions(base, { query: "injectedword" })).hits).toHaveLength(0);
    const hit = (await searchSessions(base, { query: "codexword" })).hits[0]!;
    expect(hit).toMatchObject({ source: "codex", who: "you", at: "2026-11-16T10:00:01.000Z" });
  });

  it("falls back to the project's SpecStory export when the provider transcript is gone", async () => {
    const project = path.join(root, "project");
    const history = path.join(project, ".specstory", "history");
    mkdirSync(history, { recursive: true });
    writeFileSync(
      path.join(history, "2026-09-01_08-00-00Z-title.md"),
      [
        "<!-- Generated by SpecStory, Markdown v2.1.0 -->",
        "",
        `<!-- Claude Code Session ${ID4} (2026-09-01 08:00:00Z) -->`,
        "",
        "_**User (2026-09-01 08:00:00Z)**_",
        "",
        "how do we handle the oldword case?",
        "",
        "---",
        "",
        "_**Agent (claude-opus 2026-09-01 08:00:09Z)**_",
        "",
        '<tool-use data-tool-type="shell" data-tool-name="Bash"><details>',
        "toolblockword",
        "</details></tool-use>",
        "",
        "We handle it with a fallback.",
        "",
      ].join("\n"),
    );
    const base = deps([session({ agentId: "s1", sessionIds: [ID4], cwds: [project] })]);
    const hit = (await searchSessions(base, { query: "oldword" })).hits[0]!;
    expect(hit).toMatchObject({ source: "specstory", who: "you", at: "2026-09-01T08:00:00.000Z" });
    expect((await searchSessions(base, { query: "toolblockword" })).hits).toHaveLength(0);
    expect((await searchSessions(base, { query: "fallback" })).hits[0]!.who).toBe("agent");
  });

  it("a session with no transcript anywhere matches on its title and is counted", async () => {
    const base = deps([session({ agentId: "agy", title: "Quran flashcards plan", sessionIds: [] })]);
    const outcome = await searchSessions(base, { query: "quran flashcards" });
    expect(outcome.hits[0]).toMatchObject({ who: "title", source: "title", snippet: "Quran flashcards plan" });
    expect(outcome.sessionsWithoutTranscript).toBe(1);
  });
});

describe("privacy guard", () => {
  it("withholds the snippet for a private workspace but still returns title, date and who", async () => {
    mkdirSync(path.join(root, "personal"), { recursive: true });
    writeFileSync(path.join(root, "personal", ".local-only"), "");
    writeClaude(ID1, [claudeLine("user", "her phone number is secretword", "2026-11-01T10:00:00.000Z")]);
    const outcome = await searchSessions(
      deps([
        session({ agentId: "p1", title: "Private chat", sessionIds: [ID1], cwds: [path.join(root, "personal")] }),
      ]),
      { query: "secretword" },
    );
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]).toMatchObject({
      private: true,
      snippet: PRIVATE_TEXT_WITHHELD,
      at: "2026-11-01T10:00:00.000Z",
    });
    expect(outcome.hits[0]!.session.title).toBe("Private chat");
    expect(JSON.stringify(outcome.hits[0])).not.toContain("phone number");
  });

  it("also withholds the Debrief workspace, whose cwd is an ordinary folder", async () => {
    writeClaude(ID1, [claudeLine("user", "debrief secretword", "2026-11-01T10:00:00.000Z")]);
    const hit = (
      await searchSessions(
        deps([session({ agentId: "d1", workspaceId: "wks_234bcdec1e111677", sessionIds: [ID1] })]),
        { query: "secretword" },
      )
    ).hits[0]!;
    expect(hit.snippet).toBe(PRIVATE_TEXT_WITHHELD);
  });

  it("withholds a workspace titled Debrief, and does not withhold an exam/ folder with only .private-project", async () => {
    mkdirSync(path.join(root, "exam"), { recursive: true });
    writeFileSync(path.join(root, "exam", ".private-project"), "");
    writeClaude(ID1, [claudeLine("user", "studyword", "2026-11-01T10:00:00.000Z")]);
    const study = (
      await searchSessions(deps([session({ agentId: "e1", sessionIds: [ID1], cwds: [path.join(root, "exam")] })]), { query: "studyword" })
    ).hits[0]!;
    expect(study.private).toBe(false);
    expect(study.snippet).toContain("studyword");
    const debrief = (
      await searchSessions(deps([session({ agentId: "d2", workspaceTitle: "Debrief", sessionIds: [ID1] })]), { query: "studyword" })
    ).hits[0]!;
    expect(debrief.snippet).toBe(PRIVATE_TEXT_WITHHELD);
  });

  it("withholds a private session's title-only hit too", async () => {
    const hit = (
      await searchSessions(
        deps([session({ agentId: "d1", workspaceId: "wks_234bcdec1e111677", title: "secretword plan" })]),
        { query: "secretword" },
      )
    ).hits[0]!;
    expect(hit.snippet).toBe(PRIVATE_TEXT_WITHHELD);
  });

  it("searchPrivateText: true lifts the guard", async () => {
    mkdirSync(path.join(root, "personal"), { recursive: true });
    writeFileSync(path.join(root, "personal", ".local-only"), "");
    writeClaude(ID1, [claudeLine("user", "visible secretword", "2026-11-01T10:00:00.000Z")]);
    const config = { searchPrivateText: true, privateWorkspaceIds: [] };
    const hit = (
      await searchSessions(
        deps([session({ agentId: "p1", sessionIds: [ID1], cwds: [path.join(root, "personal")] })], {
          config,
          guard: createPrivacyGuard({ config }),
        }),
        { query: "secretword" },
      )
    ).hits[0]!;
    expect(hit.snippet).toContain("visible secretword");
    expect(hit.private).toBe(true);
  });
});

describe("time budget", () => {
  it("returns what it has and says partial when the budget runs out", async () => {
    writeClaude(ID1, [claudeLine("user", "found", "2026-11-01T10:00:00.000Z")]);
    let clock = 0;
    const outcome = await searchSessions(
      deps(
        [
          session({ agentId: "a", sessionIds: [ID1] }),
          session({ agentId: "b", sessionIds: [ID1] }),
        ],
        { now: () => (clock += 100), timeBudgetMs: 150 },
      ),
      { query: "found" },
    );
    expect(outcome.partial).toBe(true);
    expect(outcome.hits.length).toBeLessThan(2);
  });
});

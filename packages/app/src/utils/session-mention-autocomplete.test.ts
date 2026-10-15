import { describe, expect, it } from "vitest";
import {
  applySessionMentionReplacement,
  filterSessionMentionSuggestions,
  formatSessionMention,
  SESSION_MENTION_LIMIT,
  type SessionMentionCandidate,
} from "@/utils/session-mention-autocomplete";

const ID_A = "1fb50fd4-cda1-4d1f-a49b-8dd0aa21cab6";

function candidate(
  agentId: string,
  title: string | null,
  minutesAgo: number | null,
  extra: Partial<SessionMentionCandidate> = {},
): SessionMentionCandidate {
  return {
    agentId,
    title,
    lastActivityAt:
      minutesAgo === null ? null : new Date(Date.UTC(2026, 9, 4, 12, 0) - minutesAgo * 60_000),
    ...extra,
  };
}

describe("filterSessionMentionSuggestions", () => {
  const candidates = [
    candidate("a-old", "Quran flashcards", 600),
    candidate(ID_A, "Local CLIProxyAPI setup", 30),
    candidate("a-new", "Offline-run loop fix", 5),
    candidate("a-never", "Karabiner PiP keys", null),
  ];

  it("lists sessions most recently active first, sessions without activity last", () => {
    const result = filterSessionMentionSuggestions({ candidates, query: "" });
    expect(result.map((entry) => entry.agentId)).toEqual(["a-new", ID_A, "a-old", "a-never"]);
  });

  it("matches the query against the title, case-insensitively", () => {
    const result = filterSessionMentionSuggestions({ candidates, query: "cliproxy" });
    expect(result.map((entry) => entry.agentId)).toEqual([ID_A]);
  });

  it("matches an id prefix", () => {
    const result = filterSessionMentionSuggestions({ candidates, query: "1fb50f" });
    expect(result.map((entry) => entry.agentId)).toEqual([ID_A]);
  });

  it("excludes the current session and archived sessions", () => {
    const result = filterSessionMentionSuggestions({
      candidates: [
        ...candidates,
        candidate("a-archived", "Archived thing", 1, { archivedAt: new Date() }),
      ],
      query: "",
      excludeAgentId: "a-new",
    });
    const ids = result.map((entry) => entry.agentId);
    expect(ids).not.toContain("a-new");
    expect(ids).not.toContain("a-archived");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      candidate(`id-${index}`, `Session ${index}`, index),
    );
    expect(filterSessionMentionSuggestions({ candidates: many, query: "" })).toHaveLength(
      SESSION_MENTION_LIMIT,
    );
    expect(
      filterSessionMentionSuggestions({ candidates: many, query: "", limit: 3 }).map(
        (entry) => entry.agentId,
      ),
    ).toEqual(["id-0", "id-1", "id-2"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterSessionMentionSuggestions({ candidates, query: "zzz" })).toEqual([]);
  });

  it("collapses multi-line titles and names untitled sessions", () => {
    const result = filterSessionMentionSuggestions({
      candidates: [candidate("x", "Fix\n  the   bug", 1), candidate("y", null, 2)],
      query: "",
    });
    expect(result.map((entry) => entry.title)).toEqual(["Fix the bug", "Untitled session"]);
  });

  it("hints the workspace with the last cwd segment", () => {
    const result = filterSessionMentionSuggestions({
      candidates: [candidate("x", "T", 1, { cwd: "/Users/n/code/paseo/" })],
      query: "",
    });
    expect(result[0]?.workspaceHint).toBe("paseo");
  });
});

describe("formatSessionMention", () => {
  it("inserts the title and the FULL agent id", () => {
    expect(formatSessionMention("Local CLIProxyAPI setup", ID_A)).toBe(
      "Local CLIProxyAPI setup (1fb50fd4-cda1-4d1f-a49b-8dd0aa21cab6)",
    );
  });
});

describe("applySessionMentionReplacement", () => {
  it("replaces the @query range and keeps the text around it", () => {
    const text = "see @cli for details";
    const next = applySessionMentionReplacement({
      text,
      mention: { start: 4, end: 8, query: "cli" },
      title: "Local CLIProxyAPI setup",
      agentId: ID_A,
    });
    expect(next).toBe(`see Local CLIProxyAPI setup (${ID_A}) for details`);
  });
});

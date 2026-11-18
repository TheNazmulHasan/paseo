import { describe, expect, it } from "vitest";
import { buildHomeView } from "@getpaseo/protocol/home";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import { buildFolderIndex, type FolderIndex } from "@/folders/model";
import type { StreamItem } from "@/types/stream";
import {
  buildHomeSessions,
  findChiefAgent,
  selectLatestAssistantText,
  sessionLabel,
  sessionLocation,
  type HomeAgentSource,
  type HomeWorkspaceSource,
} from "./model";

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000);

function card(over: Partial<HomeCard> = {}): HomeCard {
  return {
    what: "OAuth secret",
    status: "Answer is ready, nobody tested it",
    waitingOn: "nazmul",
    kind: "decision",
    nextStep: "Tell Riajul yes",
    urgency: "now",
    importance: "high",
    why: "Riajul is waiting",
    looksFinished: false,
    stopped: false,
    openItems: [],
    basedOnSeq: 4,
    updatedAt: "2026-11-18T08:00:00.000Z",
    ...over,
  };
}

function agent(id: string, over: Partial<HomeAgentSource> = {}): HomeAgentSource {
  return {
    serverId: "s1",
    id,
    title: `Title ${id}`,
    status: "idle",
    requiresAttention: false,
    attentionReason: null,
    pendingPermissions: [],
    workspaceId: "w1",
    lastActivityAt: hoursAgo(1),
    lastUserMessageAt: null,
    archivedAt: null,
    labels: {},
    topicTrail: null,
    ...over,
  };
}

const finished = { requiresAttention: true, attentionReason: "finished" as const };
const errored = { status: "error" };

function workspaces(
  entries: Record<string, string>,
  server = "s1",
): Record<string, ReadonlyMap<string, HomeWorkspaceSource>> {
  return {
    [server]: new Map(
      Object.entries(entries).map(([id, name]) => [id, { id, name } as HomeWorkspaceSource]),
    ),
  };
}

function folderIndex(): FolderIndex {
  return buildFolderIndex([
    {
      serverId: "s1",
      snapshot: {
        folders: [
          {
            id: "f-faith",
            name: "Faith",
            emoji: "🕌",
            order: 0,
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ],
        membership: { w1: "f-faith" },
      },
    },
  ]);
}

function sessionsOf(agents: HomeAgentSource[], excludeIds?: ReadonlySet<string>) {
  return buildHomeSessions({
    agents,
    workspaces: workspaces({ w1: "Quran", w2: "Clients" }),
    folderIndex: folderIndex(),
    excludeIds,
  });
}

describe("buildHomeSessions: the agent -> HomeSessionInput mapping", () => {
  it("keys the session `serverId:agentId` and keeps the raw agent id for the daemon files", () => {
    const [session] = sessionsOf([agent("a1", { serverId: "s1" })]);
    expect(session.id).toBe("s1:a1");
    expect(session.agentId).toBe("a1");
    expect(session.serverId).toBe("s1");
    expect(session.workspaceId).toBe("w1");
  });

  it("carries the card from topicTrail.card, and null when there is none", () => {
    const withCard = card({ what: "Brand voice file" });
    const sessions = sessionsOf([
      agent("a1", { topicTrail: { card: withCard } }),
      agent("a2", { topicTrail: { card: null } }),
      agent("a3", { topicTrail: null }),
      agent("a4"),
    ]);
    expect(sessions[0].card).toEqual(withCard);
    expect(sessions.slice(1).map((s) => s.card)).toEqual([null, null, null]);
  });

  it("maps lastActivityAt and lastUserMessageAt to epoch ms, and a missing user message to 0", () => {
    const [a, b, c] = sessionsOf([
      agent("a", { lastActivityAt: hoursAgo(2), lastUserMessageAt: hoursAgo(3) }),
      agent("b", { lastUserMessageAt: null }),
      agent("c", { lastUserMessageAt: undefined }),
    ]);
    expect(a.lastActivityAt).toBe(hoursAgo(2).getTime());
    expect(a.lastUserMessageAt).toBe(hoursAgo(3).getTime());
    expect(b.lastUserMessageAt).toBe(0);
    expect(c.lastUserMessageAt).toBe(0);
  });

  it("uses the shared state rule: errors are stopped, only a permission is needs_you", () => {
    const sessions = sessionsOf([
      agent("perm", { pendingPermissions: [{}] }),
      agent("err", errored),
      agent("err-attn", { requiresAttention: true, attentionReason: "error" }),
      agent("run", { status: "running" }),
      agent("done", finished),
      agent("idle"),
    ]);
    expect(sessions.map((s) => [s.agentId, s.state])).toEqual([
      ["perm", "needs_you"],
      ["err", "stopped"],
      ["err-attn", "stopped"],
      ["run", "working"],
      ["done", "your_move"],
      ["idle", "parked"],
    ]);
  });

  it("gives folder and workspace display names, and null when the workspace is unknown", () => {
    const [known, other, unknown] = sessionsOf([
      agent("a1", { workspaceId: "w1" }),
      agent("a2", { workspaceId: "w2" }),
      agent("a3", { workspaceId: "nope" }),
    ]);
    expect(known.folder).toBe("Faith");
    expect(known.workspace).toBe("Quran");
    expect(sessionLocation(known)).toBe("Faith › Quran");
    expect(other.folder).toBeNull();
    expect(sessionLocation(other)).toBe("Clients");
    expect(unknown.workspace).toBeNull();
    expect(sessionLocation(unknown)).toBeNull();
    // A session in a workspace the app does not know yet still gets a row (Home never hides one).
    expect(unknown.workspaceId).toBe("nope");
  });

  it("leaves out archived agents, archiving workspaces and excluded ids (Chief)", () => {
    const hostWorkspaces = {
      s1: new Map<string, HomeWorkspaceSource>([
        ["w1", { id: "w1", name: "Quran" }],
        ["w9", { id: "w9", name: "Going", archivingAt: "2026-11-18T00:00:00.000Z" }],
      ]),
    };
    const sessions = buildHomeSessions({
      agents: [
        agent("keep"),
        agent("archived", { archivedAt: hoursAgo(1) }),
        agent("leaving", { workspaceId: "w9" }),
        agent("chief"),
      ],
      workspaces: hostWorkspaces,
      folderIndex: folderIndex(),
      excludeIds: new Set(["s1:chief"]),
    });
    expect(sessions.map((s) => s.agentId)).toEqual(["keep"]);
  });

  it("feeds buildHomeView: every session lands in exactly one group, the tally has no gap", () => {
    const sessions = sessionsOf([
      agent("wait", { topicTrail: { card: card() } }),
      agent("run", { status: "running" }),
      agent("stop", errored),
      agent("quiet", {
        topicTrail: {
          card: card({ waitingOn: "nobody", kind: "none", looksFinished: true, nextStep: null }),
        },
      }),
      agent("unread"),
    ]);
    const view = buildHomeView({
      sessions,
      brief: null,
      state: { snoozed: {}, kept: {}, chiefLayout: null },
      now: NOW,
    });
    expect(view.tally.open).toBe(5);
    expect(view.tally.gap).toBe(0);
    expect(view.queue.now.map((e) => e.session.agentId)).toEqual(["wait"]);
    expect(view.running.map((e) => e.session.agentId)).toEqual(["run"]);
    expect(view.tidy.stopped.map((e) => e.session.agentId)).toEqual(["stop"]);
    expect(view.checkOn.map((e) => e.session.agentId).sort()).toEqual(["quiet", "unread"]);
    expect(view.checkOn.find((e) => e.session.agentId === "unread")?.reading).toBe(true);
  });

  it("feeds `recent` from lastUserMessageAt", () => {
    const sessions = sessionsOf([
      agent("old", { lastUserMessageAt: hoursAgo(30) }),
      agent("new", { lastUserMessageAt: hoursAgo(1) }),
      agent("never"),
    ]);
    const view = buildHomeView({
      sessions,
      brief: null,
      state: { snoozed: {}, kept: {}, chiefLayout: null },
      now: NOW,
    });
    expect(view.recent.map((e) => e.session.agentId)).toEqual(["new", "old"]);
  });
});

describe("sessionLabel", () => {
  it("prefers the card title, then what, then the session title", () => {
    expect(sessionLabel({ card: card({ title: "Google OAuth secret" }), title: "x" })).toBe(
      "Google OAuth secret",
    );
    expect(sessionLabel({ card: card({ title: undefined }), title: "x" })).toBe("OAuth secret");
    expect(sessionLabel({ card: null, title: "Raw title" })).toBe("Raw title");
    expect(sessionLabel({ card: null, title: null })).toBeNull();
  });
});

describe("findChiefAgent", () => {
  const chief = (id: string, over: Record<string, unknown> = {}) => ({
    serverId: "s1",
    id,
    labels: { "paseo.role": "chief" },
    archivedAt: null,
    lastActivityAt: hoursAgo(1),
    ...over,
  });

  it("finds the agent labelled paseo.role=chief", () => {
    const found = findChiefAgent([
      chief("x", { labels: {} }),
      chief("y", { labels: { "paseo.role": "other" } }),
      chief("chief-1"),
    ]);
    expect(found?.id).toBe("chief-1");
  });

  it("ignores an archived Chief and takes the most recently active of several", () => {
    const found = findChiefAgent([
      chief("old", { lastActivityAt: hoursAgo(30) }),
      chief("archived", { archivedAt: new Date(NOW), lastActivityAt: hoursAgo(0) }),
      chief("recent", { lastActivityAt: hoursAgo(2) }),
    ]);
    expect(found?.id).toBe("recent");
  });

  it("returns null when no agent carries the label", () => {
    expect(findChiefAgent([chief("a", { labels: {} })])).toBeNull();
    expect(findChiefAgent([])).toBeNull();
  });
});

describe("selectLatestAssistantText", () => {
  const message = (id: string, text: string): StreamItem =>
    ({ kind: "assistant_message", id, text, timestamp: new Date(NOW) }) as StreamItem;
  const user = (id: string, text: string): StreamItem =>
    ({ kind: "user_message", id, text, timestamp: new Date(NOW) }) as StreamItem;

  it("takes the in-progress head first, else the newest settled message", () => {
    const tail = [message("1", "old"), user("2", "q"), message("3", "settled")];
    expect(selectLatestAssistantText([message("4", "streaming")], tail)).toBe("streaming");
    expect(selectLatestAssistantText([], tail)).toBe("settled");
    expect(selectLatestAssistantText(undefined, tail)).toBe("settled");
  });

  it("skips user rows and blank replies, and returns null when there is none", () => {
    expect(selectLatestAssistantText([], [message("1", "real"), message("2", "  ")])).toBe("real");
    expect(selectLatestAssistantText([], [user("1", "hi")])).toBeNull();
    expect(selectLatestAssistantText(undefined, undefined)).toBeNull();
  });
});

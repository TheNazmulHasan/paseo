import { describe, expect, it } from "vitest";
import { buildFolderIndex, UNFILED_FOLDER_KEY, type FolderIndex } from "@/folders/model";
import type { StreamItem } from "@/types/stream";
import {
  buildHomeBands,
  buildHomeMap,
  buildHomeSessions,
  countParts,
  DESK_FOLDER_KEY,
  dominantState,
  findChiefAgent,
  hasFoldedNode,
  INITIAL_HOME_FOLD_STATE,
  isNodeOpen,
  selectLatestAssistantText,
  setAllFolds,
  toggleNodeFold,
  type HomeAgentSource,
  type HomeSession,
  type HomeWorkspaceSource,
} from "./model";

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000);

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
    archivedAt: null,
    labels: {},
    topicTrail: null,
    ...over,
  };
}

function sessionIdsOf(folders: ReturnType<typeof buildHomeMap>): string[] {
  const ids: string[] = [];
  for (const folder of folders) {
    for (const workspace of folder.workspaces) {
      for (const session of workspace.sessions) ids.push(session.agentId);
    }
  }
  return ids;
}

const finished = { requiresAttention: true, attentionReason: "finished" as const };
const permission = { requiresAttention: true, attentionReason: "permission" as const };

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

function folderIndex(input?: {
  folders?: { id: string; name: string; emoji?: string | null; order: number }[];
  membership?: Record<string, string>;
}): FolderIndex {
  return buildFolderIndex([
    {
      serverId: "s1",
      snapshot: {
        folders: (input?.folders ?? []).map((folder) => ({
          id: folder.id,
          name: folder.name,
          emoji: folder.emoji ?? null,
          order: folder.order,
          createdAt: "2026-11-01T00:00:00.000Z",
        })),
        membership: input?.membership ?? {},
      },
    },
  ]);
}

const FAITH_AND_WORK = folderIndex({
  folders: [
    { id: "f-faith", name: "Faith", emoji: "🕌", order: 0 },
    { id: "f-work", name: "Work", order: 1 },
  ],
  membership: { w1: "f-faith", w2: "f-work", w3: "f-work" },
});

function sessionsOf(agents: HomeAgentSource[], index = FAITH_AND_WORK) {
  return buildHomeSessions({
    agents,
    workspaces: workspaces({ w1: "Quran", w2: "Clients", w3: "Loose", w4: "Scratch" }),
    folderIndex: index,
  });
}

describe("buildHomeSessions", () => {
  it("uses the shared state rule for every session", () => {
    const sessions = sessionsOf([
      agent("a-needs", permission),
      agent("a-perm-count", { pendingPermissions: [{}] }),
      agent("a-working", { status: "running" }),
      agent("a-move", finished),
      agent("a-parked"),
    ]);
    expect(Object.fromEntries(sessions.map((s) => [s.agentId, s.state]))).toEqual({
      "a-needs": "needs_you",
      "a-perm-count": "needs_you",
      "a-working": "working",
      "a-move": "your_move",
      "a-parked": "parked",
    });
  });

  it("never lists archived sessions or sessions of a workspace that is archiving", () => {
    const sessions = buildHomeSessions({
      agents: [
        agent("gone", { archivedAt: new Date(NOW) }),
        agent("closing", { workspaceId: "w9" }),
        agent("fine"),
      ],
      workspaces: {
        s1: new Map<string, HomeWorkspaceSource>([
          ["w1", { id: "w1", name: "Quran" }],
          ["w9", { id: "w9", name: "Closing", archivingAt: "2026-11-17T10:00:00.000Z" }],
        ]),
      },
      folderIndex: FAITH_AND_WORK,
    });
    expect(sessions.map((s) => s.agentId)).toEqual(["fine"]);
  });

  it("carries the your-move line only while the session waits, trimmed", () => {
    const sessions = sessionsOf([
      agent("move", { ...finished, topicTrail: { yourMove: "  Pick the name  " } }),
      agent("busy", { status: "running", topicTrail: { yourMove: "stale line" } }),
      agent("blank", { ...finished, topicTrail: { yourMove: "   " } }),
    ]);
    const byId = Object.fromEntries(sessions.map((s) => [s.agentId, s.yourMoveText]));
    expect(byId).toEqual({ move: "Pick the name", busy: null, blank: null });
  });

  it("resolves the workspace by map key or by id and names its folder", () => {
    const [session] = buildHomeSessions({
      agents: [agent("a", { workspaceId: "map-key-1" })],
      workspaces: {
        s1: new Map<string, HomeWorkspaceSource>([["map-key-1", { id: "w1", name: "Quran" }]]),
      },
      folderIndex: FAITH_AND_WORK,
    });
    expect(session).toMatchObject({
      workspaceKey: "s1:w1",
      workspaceId: "w1",
      workspaceName: "Quran",
      folderKey: "faith",
      folderName: "Faith",
      folderEmoji: "🕌",
    });
  });

  it("keeps a session whose workspace is unknown, without a workspace key", () => {
    const [session] = buildHomeSessions({
      agents: [agent("a", { workspaceId: "not-loaded", ...permission })],
      workspaces: workspaces({ w1: "Quran" }),
      folderIndex: FAITH_AND_WORK,
    });
    expect(session).toMatchObject({
      workspaceKey: null,
      workspaceId: "not-loaded",
      state: "needs_you",
    });
  });

  it("prefers a user-set workspace title over its derived name", () => {
    const [session] = buildHomeSessions({
      agents: [agent("a")],
      workspaces: { s1: new Map([["w1", { id: "w1", name: "branch-x", title: "My title" }]]) },
      folderIndex: FAITH_AND_WORK,
    });
    expect(session.workspaceName).toBe("My title");
  });
});

describe("buildHomeBands", () => {
  it("splits needs you, your move and working; parked has no band; newest first", () => {
    const sessions = sessionsOf([
      agent("move-old", { ...finished, lastActivityAt: hoursAgo(9) }),
      agent("move-new", { ...finished, lastActivityAt: hoursAgo(1) }),
      agent("needs", { ...permission, lastActivityAt: hoursAgo(3) }),
      agent("work", { status: "running" }),
      agent("parked"),
    ]);
    const bands = buildHomeBands(sessions);
    expect(bands.needsYou.map((s) => s.agentId)).toEqual(["needs"]);
    expect(bands.yourMove.map((s) => s.agentId)).toEqual(["move-new", "move-old"]);
    expect(bands.working.map((s) => s.agentId)).toEqual(["work"]);
  });
});

describe("buildHomeMap: tree", () => {
  const agents = [
    agent("faith-needs", { workspaceId: "w1", ...permission, lastActivityAt: hoursAgo(2) }),
    agent("faith-parked", { workspaceId: "w1", lastActivityAt: hoursAgo(50) }),
    agent("work-move", { workspaceId: "w2", ...finished, lastActivityAt: hoursAgo(5) }),
    agent("work-working", { workspaceId: "w2", status: "running", lastActivityAt: hoursAgo(1) }),
    agent("loose-move", { workspaceId: "w3", ...finished, lastActivityAt: hoursAgo(8) }),
    agent("loose-parked-only", { workspaceId: "w4", lastActivityAt: hoursAgo(70) }),
  ];

  function tree(over: Partial<Parameters<typeof buildHomeMap>[0]> = {}) {
    return buildHomeMap({
      sessions: sessionsOf(agents),
      folderIndex: FAITH_AND_WORK,
      deskKeys: [],
      showQuiet: false,
      ...over,
    });
  }

  it("orders folders: Desk first, user folders in order, Unfiled last", () => {
    const result = tree({ deskKeys: ["s1:w2"], showQuiet: true });
    expect(result.map((folder) => folder.folderKey)).toEqual([
      DESK_FOLDER_KEY,
      "faith",
      "work",
      UNFILED_FOLDER_KEY,
    ]);
    expect(result.map((folder) => folder.builtin)).toEqual(["desk", null, null, "unfiled"]);
  });

  it("builds Folder -> workspace -> session with names, states and the your-move line", () => {
    const [faith, work] = tree();
    expect(faith).toMatchObject({ folderKey: "faith", name: "Faith", emoji: "🕌" });
    expect(faith.workspaces.map((w) => w.name)).toEqual(["Quran"]);
    expect(faith.workspaces[0].sessions.map((s) => s.agentId)).toEqual(["faith-needs"]);
    expect(work.workspaces.map((w) => w.name)).toEqual(["Clients", "Loose"]);
    expect(work.workspaces[0].sessions.map((s) => s.agentId)).toEqual([
      "work-move",
      "work-working",
    ]);
  });

  it("shows open loops only: parked sessions and parked-only workspaces are hidden", () => {
    const result = tree();
    const sessionIds = sessionIdsOf(result);
    expect(sessionIds).not.toContain("faith-parked");
    expect(sessionIds).not.toContain("loose-parked-only");
    // The parked-only workspace "Scratch" left Unfiled with nothing, so Unfiled is gone too.
    expect(result.map((f) => f.folderKey)).toEqual(["faith", "work"]);
  });

  it("Show quiet brings back parked sessions and parked-only workspaces", () => {
    const result = tree({ showQuiet: true });
    const sessionIds = sessionIdsOf(result);
    expect(sessionIds).toContain("faith-parked");
    expect(sessionIds).toContain("loose-parked-only");
    const unfiled = result.find((f) => f.folderKey === UNFILED_FOLDER_KEY);
    expect(unfiled?.workspaces.map((w) => w.name)).toEqual(["Scratch"]);
    // Inside a workspace the open loops still lead.
    const quran = result[0].workspaces[0];
    expect(quran.sessions.map((s) => s.agentId)).toEqual(["faith-needs", "faith-parked"]);
  });

  it("counts everything open below a node, shown or hidden", () => {
    const [faith, work] = tree();
    expect(faith.counts).toEqual({ needsYou: 1, yourMove: 0, working: 0, open: 2 });
    expect(faith.workspaces[0].counts).toEqual({ needsYou: 1, yourMove: 0, working: 0, open: 2 });
    expect(work.counts).toEqual({ needsYou: 0, yourMove: 2, working: 1, open: 3 });
  });

  it("gives every node the dot of the most demanding thing below it", () => {
    const [faith, work] = tree();
    expect(faith.state).toBe("needs_you");
    expect(work.state).toBe("your_move");
    expect(work.workspaces[0].state).toBe("your_move");
    expect(dominantState({ needsYou: 0, yourMove: 0, working: 2, open: 2 })).toBe("working");
    expect(dominantState({ needsYou: 0, yourMove: 0, working: 0, open: 4 })).toBe("parked");
  });

  it("sorts workspaces by what they need, then by activity, and carries the newest age up", () => {
    const [, work] = tree();
    expect(work.workspaces.map((w) => w.name)).toEqual(["Clients", "Loose"]);
    expect(work.lastActivityAt).toBe(NOW - 1 * 3_600_000);
  });

  it("lists a Desk workspace in the Desk and again in its own folder", () => {
    const result = tree({ deskKeys: ["s1:w1"] });
    expect(result[0].folderKey).toBe(DESK_FOLDER_KEY);
    expect(result[0].workspaces.map((w) => w.name)).toEqual(["Quran"]);
    expect(result[1].folderKey).toBe("faith");
    expect(result[1].workspaces.map((w) => w.name)).toEqual(["Quran"]);
    // Two places, two fold keys.
    expect(result[0].workspaces[0].key).not.toBe(result[1].workspaces[0].key);
  });

  it("puts a workspace whose folder the host no longer has in Unfiled", () => {
    const stale = folderIndex({ folders: [], membership: { w1: "f-deleted" } });
    const result = buildHomeMap({
      sessions: sessionsOf([agent("a", { ...permission })], stale),
      folderIndex: stale,
      deskKeys: [],
      showQuiet: false,
    });
    expect(result.map((f) => f.folderKey)).toEqual([UNFILED_FOLDER_KEY]);
  });

  it("leaves sessions with no known workspace out of the map", () => {
    const sessions = buildHomeSessions({
      agents: [agent("lost", { workspaceId: "nope", ...permission })],
      workspaces: workspaces({ w1: "Quran" }),
      folderIndex: FAITH_AND_WORK,
    });
    expect(
      buildHomeMap({ sessions, folderIndex: FAITH_AND_WORK, deskKeys: [], showQuiet: true }),
    ).toEqual([]);
  });
});

describe("countParts", () => {
  it("reads needs you, your move, working, open, and drops what is zero", () => {
    expect(countParts({ needsYou: 2, yourMove: 3, working: 0, open: 5 })).toEqual([
      { kind: "needsYou", count: 2 },
      { kind: "yourMove", count: 3 },
      { kind: "open", count: 5 },
    ]);
    expect(
      countParts({ needsYou: 0, yourMove: 0, working: 1, open: 7 }).map((p) => p.kind),
    ).toEqual(["working", "open"]);
    expect(countParts({ needsYou: 0, yourMove: 0, working: 0, open: 4 })).toEqual([
      { kind: "open", count: 4 },
    ]);
  });
});

describe("fold state", () => {
  const sessions: HomeSession[] = sessionsOf([
    agent("a", { ...permission }),
    agent("b", { workspaceId: "w2", ...finished }),
  ]);
  const tree = buildHomeMap({
    sessions,
    folderIndex: FAITH_AND_WORK,
    deskKeys: [],
    showQuiet: false,
  });

  it("starts with folders open and workspaces folded", () => {
    expect(isNodeOpen(INITIAL_HOME_FOLD_STATE, "folder:faith", "folder")).toBe(true);
    expect(isNodeOpen(INITIAL_HOME_FOLD_STATE, "ws:faith:s1:w1", "workspace")).toBe(false);
  });

  it("toggles one node and remembers it, leaving the others alone", () => {
    let state = toggleNodeFold(INITIAL_HOME_FOLD_STATE, "ws:faith:s1:w1", "workspace");
    expect(isNodeOpen(state, "ws:faith:s1:w1", "workspace")).toBe(true);
    expect(isNodeOpen(state, "ws:work:s1:w2", "workspace")).toBe(false);
    state = toggleNodeFold(state, "folder:faith", "folder");
    expect(isNodeOpen(state, "folder:faith", "folder")).toBe(false);
    state = toggleNodeFold(state, "folder:faith", "folder");
    expect(isNodeOpen(state, "folder:faith", "folder")).toBe(true);
  });

  it("Unfold all opens every level, including nodes that appear later", () => {
    const state = setAllFolds(true);
    expect(isNodeOpen(state, "folder:never-seen", "folder")).toBe(true);
    expect(isNodeOpen(state, "ws:never-seen", "workspace")).toBe(true);
    expect(hasFoldedNode(tree, state)).toBe(false);
  });

  it("Fold all folds every level, and clears what was toggled by hand", () => {
    const toggled = toggleNodeFold(setAllFolds(true), "folder:faith", "folder");
    expect(isNodeOpen(toggled, "folder:faith", "folder")).toBe(false);
    const state = setAllFolds(false);
    expect(state.overrides).toEqual({});
    expect(isNodeOpen(state, "folder:faith", "folder")).toBe(false);
    expect(isNodeOpen(state, "ws:faith:s1:w1", "workspace")).toBe(false);
    expect(hasFoldedNode(tree, state)).toBe(true);
  });

  it("offers Unfold all while anything is folded (the default view hides the workspaces)", () => {
    expect(hasFoldedNode(tree, INITIAL_HOME_FOLD_STATE)).toBe(true);
    expect(hasFoldedNode([], INITIAL_HOME_FOLD_STATE)).toBe(false);
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

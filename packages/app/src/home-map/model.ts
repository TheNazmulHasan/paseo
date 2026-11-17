// Home map (fork mod, home-map): everything here is pure so the screen, the fold store and the
// tests share one definition of "what needs me, and where is everything".
import { hasChiefRoleLabel } from "@getpaseo/protocol/chief";
import {
  deriveSessionState,
  resolveYourMoveText,
  type SessionState,
} from "@getpaseo/protocol/session-state";
import { UNFILED_FOLDER_KEY, type FolderIndex } from "@/folders/model";
import type { StreamItem } from "@/types/stream";

export type { SessionState };

/** Folder-section keys of the two built-in folders; user folders use their group key. */
export const DESK_FOLDER_KEY = "__desk__";
export { UNFILED_FOLDER_KEY };

/**
 * The slice of an app `Agent` the map reads. `Agent` (session store) satisfies it; the server's
 * `session_states` reads the same fields from its own snapshots, through the same state rule.
 */
export interface HomeAgentSource {
  serverId: string;
  id: string;
  title: string | null;
  status: string;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissions: readonly unknown[];
  workspaceId?: string;
  lastActivityAt: Date;
  archivedAt?: Date | null;
  labels: Readonly<Record<string, string>>;
  topicTrail?: { yourMove: string | null } | null;
}

/** The slice of a `WorkspaceDescriptor` the map reads. */
export interface HomeWorkspaceSource {
  id: string;
  name: string;
  title?: string | null;
  archivingAt?: string | null;
}

export interface HomeSession {
  /** `serverId:agentId`: unique across hosts. */
  key: string;
  serverId: string;
  agentId: string;
  /** The workspace descriptor id when the workspace is known, else the agent's raw id. */
  workspaceId: string | null;
  /** `serverId:workspaceId` when the workspace is known; null otherwise (never in the map). */
  workspaceKey: string | null;
  workspaceName: string | null;
  folderKey: string | null;
  folderName: string | null;
  folderEmoji: string | null;
  title: string | null;
  state: SessionState;
  yourMoveText: string | null;
  /** Epoch ms. */
  lastActivityAt: number;
}

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function workspaceDisplayName(workspace: HomeWorkspaceSource): string {
  return workspace.title?.trim() || workspace.name?.trim() || workspace.id;
}

/**
 * One row per open (not archived) session. The state comes from the shared rule, so a session is
 * "needs you / working / your move / parked" here exactly as `session_states` says. Archived
 * agents never appear. Sessions whose workspace the app does not know yet keep a row (the bands
 * still show them) but have no `workspaceKey`, so the map leaves them out until it loads.
 */
export function buildHomeSessions(input: {
  agents: readonly HomeAgentSource[];
  /** serverId -> that host's workspaces (map key or id, either resolves). */
  workspaces: Readonly<Record<string, ReadonlyMap<string, HomeWorkspaceSource> | undefined>>;
  folderIndex: FolderIndex;
}): HomeSession[] {
  const groupsByKey = new Map(input.folderIndex.groups.map((group) => [group.key, group]));
  const lookups = new Map<string, Map<string, HomeWorkspaceSource>>();
  const lookupFor = (serverId: string): Map<string, HomeWorkspaceSource> => {
    let lookup = lookups.get(serverId);
    if (!lookup) {
      lookup = new Map();
      for (const [mapKey, workspace] of input.workspaces[serverId] ?? []) {
        lookup.set(mapKey, workspace);
        const id = normalizeId(workspace.id);
        if (id) lookup.set(id, workspace);
      }
      lookups.set(serverId, lookup);
    }
    return lookup;
  };

  const sessions: HomeSession[] = [];
  for (const agent of input.agents) {
    if (agent.archivedAt) continue;
    const rawWorkspaceId = normalizeId(agent.workspaceId);
    const workspace = rawWorkspaceId
      ? (lookupFor(agent.serverId).get(rawWorkspaceId) ?? null)
      : null;
    if (workspace?.archivingAt) continue;
    const workspaceKey = workspace ? `${agent.serverId}:${workspace.id}` : null;
    const folderKey = workspaceKey
      ? (input.folderIndex.workspaceFolderKey.get(workspaceKey) ?? null)
      : null;
    const group = folderKey ? (groupsByKey.get(folderKey) ?? null) : null;
    const state = deriveSessionState({
      status: agent.status,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      pendingPermissionCount: agent.pendingPermissions.length,
    });
    sessions.push({
      key: `${agent.serverId}:${agent.id}`,
      serverId: agent.serverId,
      agentId: agent.id,
      workspaceId: workspace ? workspace.id : rawWorkspaceId,
      workspaceKey,
      workspaceName: workspace ? workspaceDisplayName(workspace) : null,
      folderKey: group ? group.key : null,
      folderName: group ? group.name : null,
      folderEmoji: group ? group.emoji : null,
      title: agent.title?.trim() || null,
      state,
      yourMoveText: resolveYourMoveText(state, agent.topicTrail?.yourMove),
      lastActivityAt: agent.lastActivityAt.getTime(),
    });
  }
  return sessions;
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------

export interface HomeBands {
  needsYou: HomeSession[];
  yourMove: HomeSession[];
  working: HomeSession[];
}

/** Needs you, Your move and Working, each newest activity first. Parked sessions have no band. */
export function buildHomeBands(sessions: readonly HomeSession[]): HomeBands {
  const pick = (state: SessionState): HomeSession[] =>
    sessions
      .filter((session) => session.state === state)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return { needsYou: pick("needs_you"), yourMove: pick("your_move"), working: pick("working") };
}

// ---------------------------------------------------------------------------------------------
// The map: Folder -> workspace -> session
// ---------------------------------------------------------------------------------------------

export interface HomeCounts {
  needsYou: number;
  yourMove: number;
  working: number;
  /** Every open (not archived) session below, parked ones included, shown or not. */
  open: number;
}

export type HomeBuiltinFolder = "desk" | "unfiled";

export interface HomeWorkspaceNode {
  kind: "workspace";
  /** Fold key; includes the folder, since a workspace can sit in the Desk and in its folder. */
  key: string;
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  name: string;
  counts: HomeCounts;
  /** The state to draw: needs_you, else your_move, else working, else parked. */
  state: SessionState;
  lastActivityAt: number;
  /** Sessions the map shows: open loops only, unless "Show quiet" is on. */
  sessions: HomeSession[];
}

export interface HomeFolderNode {
  kind: "folder";
  key: string;
  /** The folder-section key: `DESK_FOLDER_KEY`, `UNFILED_FOLDER_KEY` or a user folder's group key. */
  folderKey: string;
  builtin: HomeBuiltinFolder | null;
  name: string;
  emoji: string | null;
  counts: HomeCounts;
  state: SessionState;
  lastActivityAt: number;
  workspaces: HomeWorkspaceNode[];
}

function emptyCounts(): HomeCounts {
  return { needsYou: 0, yourMove: 0, working: 0, open: 0 };
}

function addToCounts(counts: HomeCounts, session: HomeSession): void {
  counts.open += 1;
  if (session.state === "needs_you") counts.needsYou += 1;
  else if (session.state === "your_move") counts.yourMove += 1;
  else if (session.state === "working") counts.working += 1;
}

function mergeCounts(into: HomeCounts, from: HomeCounts): void {
  into.needsYou += from.needsYou;
  into.yourMove += from.yourMove;
  into.working += from.working;
  into.open += from.open;
}

/** What a node's dot says: the most demanding thing below it. */
export function dominantState(counts: HomeCounts): SessionState {
  if (counts.needsYou > 0) return "needs_you";
  if (counts.yourMove > 0) return "your_move";
  if (counts.working > 0) return "working";
  return "parked";
}

const NODE_STATE_RANK: Record<SessionState, number> = {
  needs_you: 0,
  your_move: 1,
  working: 2,
  parked: 3,
};

function byAttention(
  a: { state: SessionState; lastActivityAt: number },
  b: { state: SessionState; lastActivityAt: number },
): number {
  return NODE_STATE_RANK[a.state] - NODE_STATE_RANK[b.state] || b.lastActivityAt - a.lastActivityAt;
}

export type HomeCountKind = "needsYou" | "yourMove" | "working" | "open";

/**
 * The parts of a node's count line, in reading order: "2 need you · 3 your move · 1 working · 5
 * open". A part with nothing in it is left out, so a quiet node reads just "5 open".
 */
export function countParts(counts: HomeCounts): { kind: HomeCountKind; count: number }[] {
  const parts: { kind: HomeCountKind; count: number }[] = [
    { kind: "needsYou", count: counts.needsYou },
    { kind: "yourMove", count: counts.yourMove },
    { kind: "working", count: counts.working },
    { kind: "open", count: counts.open },
  ];
  return parts.filter((part) => part.count > 0);
}

/** An open loop is any session that is not parked. */
export function isOpenLoop(session: Pick<HomeSession, "state">): boolean {
  return session.state !== "parked";
}

function groupByWorkspace(sessions: readonly HomeSession[]): Map<string, HomeSession[]> {
  const byWorkspace = new Map<string, HomeSession[]>();
  for (const session of sessions) {
    if (!session.workspaceKey) continue;
    const list = byWorkspace.get(session.workspaceKey);
    if (list) list.push(session);
    else byWorkspace.set(session.workspaceKey, [session]);
  }
  return byWorkspace;
}

/**
 * Which workspaces sit in which folder section. A Desk workspace is listed in the Desk and again in
 * its own folder. Membership of a folder the host no longer has counts as Unfiled, as in the sidebar.
 */
function membersByFolder(input: {
  workspaceKeys: Iterable<string>;
  folderIndex: FolderIndex;
  deskKeys: ReadonlySet<string>;
  sectionKeys: readonly string[];
}): Map<string, string[]> {
  const groupKeys = new Set(input.folderIndex.groups.map((group) => group.key));
  const members = new Map<string, string[]>(input.sectionKeys.map((key) => [key, []]));
  for (const workspaceKey of input.workspaceKeys) {
    if (input.deskKeys.has(workspaceKey)) members.get(DESK_FOLDER_KEY)?.push(workspaceKey);
    const folderKey = input.folderIndex.workspaceFolderKey.get(workspaceKey);
    const target = folderKey && groupKeys.has(folderKey) ? folderKey : UNFILED_FOLDER_KEY;
    members.get(target)?.push(workspaceKey);
  }
  return members;
}

function countSessions(sessions: readonly HomeSession[]): {
  counts: HomeCounts;
  lastActivityAt: number;
} {
  const counts = emptyCounts();
  let lastActivityAt = 0;
  for (const session of sessions) {
    addToCounts(counts, session);
    lastActivityAt = Math.max(lastActivityAt, session.lastActivityAt);
  }
  return { counts, lastActivityAt };
}

/**
 * Folder -> workspace -> session, with the sidebar's folders: the Desk first (the workspaces on
 * the desk), then the user's folders in their order, Unfiled last. A workspace that is on the Desk
 * also shows in its own folder, like the sidebar does.
 *
 * Open loops only by default: parked sessions are hidden, and a workspace or folder left with
 * nothing to show disappears. `showQuiet` brings parked sessions and parked-only workspaces back.
 * Counts always cover everything open below a node, shown or not, so a folded node still tells
 * the whole story. Workspaces with no open sessions never appear.
 */
export function buildHomeMap(input: {
  sessions: readonly HomeSession[];
  folderIndex: FolderIndex;
  /** Desk members, `serverId:workspaceId`. */
  deskKeys: readonly string[];
  showQuiet: boolean;
}): HomeFolderNode[] {
  const byWorkspace = groupByWorkspace(input.sessions);
  const sections: { folderKey: string; builtin: HomeBuiltinFolder | null }[] = [
    { folderKey: DESK_FOLDER_KEY, builtin: "desk" },
    ...input.folderIndex.groups.map((group) => ({ folderKey: group.key, builtin: null })),
    { folderKey: UNFILED_FOLDER_KEY, builtin: "unfiled" as const },
  ];
  const members = membersByFolder({
    workspaceKeys: byWorkspace.keys(),
    folderIndex: input.folderIndex,
    deskKeys: new Set(input.deskKeys),
    sectionKeys: sections.map((section) => section.folderKey),
  });
  const groupsByKey = new Map(input.folderIndex.groups.map((group) => [group.key, group]));

  const folders: HomeFolderNode[] = [];
  for (const { folderKey, builtin } of sections) {
    const workspaces: HomeWorkspaceNode[] = [];
    const folderCounts = emptyCounts();
    let folderActivity = 0;
    for (const workspaceKey of members.get(folderKey) ?? []) {
      const all = byWorkspace.get(workspaceKey) ?? [];
      const { counts, lastActivityAt } = countSessions(all);
      mergeCounts(folderCounts, counts);
      folderActivity = Math.max(folderActivity, lastActivityAt);
      const shown = (input.showQuiet ? [...all] : all.filter(isOpenLoop)).sort(byAttention);
      if (shown.length === 0) continue;
      workspaces.push({
        kind: "workspace",
        key: `ws:${folderKey}:${workspaceKey}`,
        serverId: all[0].serverId,
        workspaceId: all[0].workspaceId ?? workspaceKey,
        workspaceKey,
        name: all[0].workspaceName ?? workspaceKey,
        counts,
        state: dominantState(counts),
        lastActivityAt,
        sessions: shown,
      });
    }
    if (workspaces.length === 0) continue;
    workspaces.sort(byAttention);
    const group = builtin ? null : (groupsByKey.get(folderKey) ?? null);
    folders.push({
      kind: "folder",
      key: `folder:${folderKey}`,
      folderKey,
      builtin,
      name: group?.name ?? "",
      emoji: group?.emoji ?? null,
      counts: folderCounts,
      state: dominantState(folderCounts),
      lastActivityAt: folderActivity,
      workspaces,
    });
  }
  return folders;
}

// ---------------------------------------------------------------------------------------------
// Fold state: baseline + per-node overrides, so "Fold all" also covers nodes that appear later
// ---------------------------------------------------------------------------------------------

export type HomeFoldLevel = "folder" | "workspace";
export type HomeFoldBaseline = "default" | "open" | "folded";

export interface HomeFoldState {
  baseline: HomeFoldBaseline;
  /** Node key -> open. Only nodes the user toggled by hand since the last Fold/Unfold all. */
  overrides: Record<string, boolean>;
}

export const INITIAL_HOME_FOLD_STATE: HomeFoldState = { baseline: "default", overrides: {} };

/** With no choice made, folders are open (the picture) and workspaces are folded (the detail). */
export function isNodeOpen(state: HomeFoldState, key: string, level: HomeFoldLevel): boolean {
  const override = state.overrides[key];
  if (override !== undefined) return override;
  if (state.baseline === "open") return true;
  if (state.baseline === "folded") return false;
  return level === "folder";
}

export function toggleNodeFold(
  state: HomeFoldState,
  key: string,
  level: HomeFoldLevel,
): HomeFoldState {
  return {
    baseline: state.baseline,
    overrides: { ...state.overrides, [key]: !isNodeOpen(state, key, level) },
  };
}

/** Unfold all (`true`) or Fold all (`false`): every node, current and future, follows it. */
export function setAllFolds(open: boolean): HomeFoldState {
  return { baseline: open ? "open" : "folded", overrides: {} };
}

/** True while some node that has something inside it is folded: the button then says Unfold all. */
export function hasFoldedNode(tree: readonly HomeFolderNode[], state: HomeFoldState): boolean {
  return tree.some(
    (folder) =>
      !isNodeOpen(state, folder.key, "folder") ||
      folder.workspaces.some((workspace) => !isNodeOpen(state, workspace.key, "workspace")),
  );
}

// ---------------------------------------------------------------------------------------------
// Chief
// ---------------------------------------------------------------------------------------------

export interface HomeChiefCandidate {
  serverId: string;
  id: string;
  labels: Readonly<Record<string, string>>;
  archivedAt?: Date | null;
  lastActivityAt: Date;
}

/** The non-archived agent labelled `paseo.role=chief`; the most recently active one if several. */
export function findChiefAgent<T extends HomeChiefCandidate>(agents: Iterable<T>): T | null {
  let best: T | null = null;
  for (const agent of agents) {
    if (agent.archivedAt || !hasChiefRoleLabel(agent.labels)) continue;
    if (!best || agent.lastActivityAt.getTime() > best.lastActivityAt.getTime()) best = agent;
  }
  return best;
}

/** The newest assistant message of a stream: the in-progress head first, else the settled tail. */
export function selectLatestAssistantText(
  head: readonly StreamItem[] | undefined,
  tail: readonly StreamItem[] | undefined,
): string | null {
  for (const items of [head, tail]) {
    if (!items) continue;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "assistant_message" && item.text.trim().length > 0) return item.text;
    }
  }
  return null;
}

// Home v2 (fork mod, home-map): the pure mapping from the app's agents onto what the shared
// `buildHomeView` (protocol/home.ts) reads, plus the Chief lookup. Grouping itself is NOT here:
// the protocol function is the one definition, so the screen and Chief's `home_get` agree.
import { hasChiefRoleLabel } from "@getpaseo/protocol/chief";
import type { HomeSessionInput } from "@getpaseo/protocol/home";
import { deriveSessionState } from "@getpaseo/protocol/session-state";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";
import { UNFILED_FOLDER_KEY, type FolderIndex } from "@/folders/model";
import type { StreamItem } from "@/types/stream";

export { UNFILED_FOLDER_KEY };

/**
 * The slice of an app `Agent` Home reads. `Agent` (session store) satisfies it; `topicTrail.card`
 * is the model's reading of the session (what, status, who waits, urgency...).
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
  /** The last message HE sent; the daemon keeps cache-warm pings out of it. */
  lastUserMessageAt?: Date | null;
  archivedAt?: Date | null;
  labels: Readonly<Record<string, string>>;
  topicTrail?: { card?: HomeCard | null } | null;
}

/** The slice of a `WorkspaceDescriptor` Home reads. */
export interface HomeWorkspaceSource {
  id: string;
  name: string;
  title?: string | null;
  archivingAt?: string | null;
}

/** A `HomeSessionInput` that also knows where to open it. */
export interface HomeSession extends HomeSessionInput {
  /** `serverId:agentId`: unique across hosts (same as `id`). */
  id: string;
  /** The raw agent id: what the daemon's brief, snooze and layout files use. */
  agentId: string;
  serverId: string;
  /** The workspace descriptor id when the workspace is known, else the agent's raw value. */
  workspaceId: string | null;
}

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function workspaceDisplayName(workspace: HomeWorkspaceSource): string {
  return workspace.title?.trim() || workspace.name?.trim() || workspace.id;
}

/**
 * One input row per open (not archived) session, for `buildHomeView`. The state comes from the
 * shared rule (`deriveSessionState`: errors are `stopped`, `needs_you` is a pending permission
 * only). `folder` and `workspace` are display names. Sessions whose workspace is not known yet
 * keep a row (Home never hides a session) with `workspace: null`.
 */
export function buildHomeSessions(input: {
  agents: readonly HomeAgentSource[];
  /** serverId -> that host's workspaces (map key or id, either resolves). */
  workspaces: Readonly<Record<string, ReadonlyMap<string, HomeWorkspaceSource> | undefined>>;
  folderIndex: FolderIndex;
  /** Agent ids to leave out (the Chief agent: it has its own bar). `serverId:agentId`. */
  excludeIds?: ReadonlySet<string>;
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
    const key = `${agent.serverId}:${agent.id}`;
    if (input.excludeIds?.has(key)) continue;
    const rawWorkspaceId = normalizeId(agent.workspaceId);
    const workspace = rawWorkspaceId
      ? (lookupFor(agent.serverId).get(rawWorkspaceId) ?? null)
      : null;
    if (workspace?.archivingAt) continue;
    const folderKey = workspace
      ? input.folderIndex.workspaceFolderKey.get(`${agent.serverId}:${workspace.id}`)
      : undefined;
    const group = folderKey ? groupsByKey.get(folderKey) : undefined;
    sessions.push(toHomeSession(agent, key, rawWorkspaceId, workspace, group?.name ?? null));
  }
  return sessions;
}

function toHomeSession(
  agent: HomeAgentSource,
  key: string,
  rawWorkspaceId: string | null,
  workspace: HomeWorkspaceSource | null,
  folderName: string | null,
): HomeSession {
  return {
    id: key,
    agentId: agent.id,
    serverId: agent.serverId,
    workspaceId: workspace ? workspace.id : rawWorkspaceId,
    title: agent.title?.trim() || null,
    state: deriveSessionState({
      status: agent.status,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      pendingPermissionCount: agent.pendingPermissions.length,
    }),
    card: agent.topicTrail?.card ?? null,
    lastActivityAt: agent.lastActivityAt.getTime(),
    lastUserMessageAt: agent.lastUserMessageAt ? agent.lastUserMessageAt.getTime() : 0,
    folder: folderName,
    workspace: workspace ? workspaceDisplayName(workspace) : null,
  };
}

/** The name Home shows for a session: the card's title, else what, else the session title. */
export function sessionLabel(session: Pick<HomeSession, "card" | "title">): string | null {
  return session.card?.title?.trim() || session.card?.what?.trim() || session.title?.trim() || null;
}

/** "Folder › Workspace", either part optional; null when neither is known. */
export function sessionLocation(session: Pick<HomeSession, "folder" | "workspace">): string | null {
  const parts = [session.folder, session.workspace].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" › ") : null;
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

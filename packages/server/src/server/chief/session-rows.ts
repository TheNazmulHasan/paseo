import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import type { FoldersSnapshot } from "@getpaseo/protocol/folders";
import {
  buildWorkspaceLinkUrl,
  buildWorkspaceMarkdownLink,
} from "@getpaseo/protocol/workspace-link";

import {
  deriveSessionState,
  resolveYourMoveText,
  type SessionState,
} from "@getpaseo/protocol/session-state";

/** The slice of an agent payload the rows read; `AgentSnapshotPayload` satisfies it. */
export interface AgentStateSource {
  id: string;
  title?: string | null;
  provider: string;
  model?: string | null;
  workspaceId?: string;
  status: string;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissions?: readonly unknown[];
  updatedAt: string;
  archivedAt?: string | null;
  internal?: boolean;
  topicTrail?: { yourMove: string | null } | null;
}

export interface WorkspaceSource {
  workspaceId: string;
  projectId: string;
  cwd: string;
  title: string | null;
  displayName: string;
  pinnedAt?: string | null;
  background?: boolean;
  archivedAt?: string | null;
}

export interface SessionStateRow {
  agentId: string;
  title: string | null;
  provider: string;
  model: string | null;
  workspaceId: string | null;
  workspaceTitle: string | null;
  projectName: string | null;
  /** Folder name; null when the workspace is Unfiled. */
  folder: string | null;
  folderId: string | null;
  pinned: boolean;
  background: boolean;
  state: SessionState;
  /** What the agent waits on from the user (the topic trail's "Your move" line); null when none. */
  yourMoveText: string | null;
  lastActivityAt: string | null;
  /** Markdown link that opens this session (agent deep link). */
  link: string | null;
  url: string | null;
  /** Markdown link to the session's workspace; the chat renderer opens it in place. */
  workspaceLink: string | null;
}

export interface BuildRowsInput {
  agents: readonly AgentStateSource[];
  /** Stored `lastActivityAt` by agent id; the agent's `updatedAt` stands in when missing. */
  lastActivityById: ReadonlyMap<string, string>;
  workspaces: ReadonlyMap<string, WorkspaceSource>;
  projectNames: ReadonlyMap<string, string>;
  folders: FoldersSnapshot | null;
  serverId?: string;
}

/**
 * One row per live, non-archived, non-internal session. Archived and internal agents never
 * appear: Chief's map is the open loops, and `search_sessions` is how it finds the closed ones.
 */
export function buildSessionStateRows(input: BuildRowsInput): SessionStateRow[] {
  const foldersById = new Map((input.folders?.folders ?? []).map((folder) => [folder.id, folder]));
  const rows: SessionStateRow[] = [];
  for (const agent of input.agents) {
    if (agent.archivedAt || agent.internal) continue;
    const workspace = agent.workspaceId ? (input.workspaces.get(agent.workspaceId) ?? null) : null;
    const folderId = agent.workspaceId ? (input.folders?.membership[agent.workspaceId] ?? null) : null;
    const folder = folderId ? (foldersById.get(folderId) ?? null) : null;
    const state = deriveSessionState({
      status: agent.status,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
    });
    const label = agent.title?.trim() || agent.id.slice(0, 8);
    const url = input.serverId
      ? buildAgentDeepLink({ serverId: input.serverId, agentId: agent.id })
      : null;
    const workspaceTitle = workspace ? (workspace.title ?? workspace.displayName) : null;
    rows.push({
      agentId: agent.id,
      title: agent.title ?? null,
      provider: agent.provider,
      model: agent.model ?? null,
      workspaceId: agent.workspaceId ?? null,
      workspaceTitle,
      projectName: workspace ? (input.projectNames.get(workspace.projectId) ?? null) : null,
      folder: folder?.name ?? null,
      folderId: folder?.id ?? null,
      pinned: Boolean(workspace?.pinnedAt),
      background: workspace?.background === true,
      state,
      yourMoveText: resolveYourMoveText(state, agent.topicTrail?.yourMove),
      lastActivityAt: input.lastActivityById.get(agent.id) ?? agent.updatedAt ?? null,
      link: url ? buildWorkspaceMarkdownLink(label, url) : null,
      url,
      workspaceLink:
        input.serverId && agent.workspaceId
          ? buildWorkspaceMarkdownLink(
              workspaceTitle ?? label,
              buildWorkspaceLinkUrl({
                serverId: input.serverId,
                workspaceId: agent.workspaceId,
                view: "workspace",
              }),
            )
          : null,
    });
  }
  return rows;
}

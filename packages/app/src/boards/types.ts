/**
 * Boards (fork mod #13): named screens of agent sessions from ANY workspaces and hosts,
 * arranged with the same panes, tab strips and Arrange presets a workspace has.
 *
 * A board's layout is a normal WorkspaceLayout (so arrange/model.ts works on it unchanged);
 * every tab targets {kind:"agent", agentId}, and `origins` says where that agent lives.
 */
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";

/** Where a board tab's agent lives. */
export interface BoardTabOrigin {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  /** "live" is the built-in board of every agent that is running or needs you. */
  kind: "user" | "live";
  layout: WorkspaceLayout;
  /** Split-size overrides by group id, like the workspace store's splitSizesByWorkspace. */
  splitSizes: Record<string, number[]>;
  origins: Record<string, BoardTabOrigin>;
}

export interface BoardSummary {
  id: string;
  name: string;
  kind: Board["kind"];
  sessionCount: number;
}

/** A session to put on a board. */
export type BoardSessionRef = BoardTabOrigin;

export const LIVE_BOARD_ID = "live";

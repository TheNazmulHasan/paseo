/**
 * Boards (fork mod #13): named screens of sessions from ANY workspaces and hosts,
 * arranged with the same panes, tab strips and Arrange presets a workspace has.
 *
 * A board's layout is a normal WorkspaceLayout (so arrange/model.ts works on it unchanged);
 * every tab targets {kind:"agent", agentId} or {kind:"file", path}, and `origins` says where
 * that agent or file lives.
 */
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";

/** Where a board tab's agent or file lives. An agent tab has `agentId`, a file tab `path`. */
export interface BoardTabOrigin {
  serverId: string;
  workspaceId: string;
  agentId?: string;
  path?: string;
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
  /** The Files explorer on the right edge; follows the focused pane's workspace. Off when absent. */
  explorerOpen?: boolean;
}

export interface BoardSummary {
  id: string;
  name: string;
  kind: Board["kind"];
  sessionCount: number;
}

/** An agent session or an open file to put on a board. */
export type BoardSessionRef = BoardTabOrigin;

export const LIVE_BOARD_ID = "live";

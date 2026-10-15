import { useEffect, useMemo } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBoardPaneMru } from "@/boards/board-mru-store";
import { useBoard, selectBoardTab } from "@/boards/controller";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import {
  boardWorkspaceKey,
  orderBoardSwitcherTabIds,
  findBoardPane,
  resolvePaneActiveTabId,
  resolveRenderableTabIds,
} from "@/boards/screen-helpers";
import {
  fallbackBoardWorkspaceIdentity,
  useBoardWorkspaceIdentities,
} from "@/boards/use-board-workspace-identity";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { TAB_SWITCHER_VISIBLE_LIMIT } from "@/tab-switcher/model";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";

/** True on `/boards/<id>`: the recent-tabs switcher then works inside the focused pane. */
export function useIsBoardRoute(): boolean {
  return parseBoardIdFromPathname(usePathname()) !== null;
}

/**
 * Board scope for the recent-tabs switcher (Boards, fork mod #13). On a board route the rows
 * are the agent and file tabs of the FOCUSED pane only, most recently used first with the tab on screen
 * as row 0, and committing selects the tab in that pane instead of navigating away.
 * Off a board route this does nothing, and the global candidates stay in charge.
 */
export function useBoardSwitcherCandidateSync(): void {
  const { t } = useTranslation();
  const boardId = parseBoardIdFromPathname(usePathname());
  const board = useBoard(boardId);
  const identities = useBoardWorkspaceIdentities();
  const { agents } = useAggregatedAgents({ demand: false });
  const setCandidates = useTabSwitcherStore((state) => state.setCandidates);

  const focusedPaneId = board?.layout.focusedPaneId ?? null;
  const mru = useBoardPaneMru(boardId ?? "", focusedPaneId);

  const candidates = useMemo<TabSwitcherCandidate[]>(() => {
    if (!board || !boardId) {
      return [];
    }
    const pane = findBoardPane(board.layout.root, board.layout.focusedPaneId);
    if (!pane) {
      return [];
    }
    const agentByKey = new Map(agents.map((agent) => [`${agent.serverId}:${agent.id}`, agent]));
    const orderedTabIds = orderBoardSwitcherTabIds({
      tabIds: resolveRenderableTabIds(pane, board.origins),
      activeTabId: resolvePaneActiveTabId(pane),
      mru,
      limit: TAB_SWITCHER_VISIBLE_LIMIT,
    });
    const rows: TabSwitcherCandidate[] = [];
    for (const tabId of orderedTabIds) {
      const origin = board.origins[tabId];
      if (!origin) {
        continue;
      }
      const identity =
        identities.get(boardWorkspaceKey(origin)) ??
        fallbackBoardWorkspaceIdentity(origin.workspaceId);
      if (origin.agentId === undefined) {
        if (!origin.path) {
          continue;
        }
        rows.push({
          kind: "file",
          serverId: origin.serverId,
          workspaceId: origin.workspaceId,
          path: origin.path,
          // A file has no activity clock; the board's own MRU already ordered the rows.
          at: 0,
          title: origin.path.split("/").findLast(Boolean) ?? origin.path,
          subtitle: identity.workspaceName,
          status: null,
          requiresAttention: false,
          iconDataUri: identity.iconDataUri,
          projectInitial: identity.initial,
          projectViewKey: identity.projectViewKey,
          commit: () => selectBoardTab(boardId, pane.id, tabId),
        });
        continue;
      }
      const agent = agentByKey.get(`${origin.serverId}:${origin.agentId}`);
      rows.push({
        kind: "agent",
        serverId: origin.serverId,
        agentId: origin.agentId,
        at: agent?.lastActivityAt.getTime() ?? 0,
        title: agent?.title || t("shell.commandCenter.newAgent"),
        subtitle: identity.workspaceName,
        status: agent?.status ?? null,
        requiresAttention: Boolean(agent?.requiresAttention),
        iconDataUri: identity.iconDataUri,
        projectInitial: identity.initial,
        projectViewKey: identity.projectViewKey,
        commit: () => selectBoardTab(boardId, pane.id, tabId),
      });
    }
    return rows;
  }, [agents, board, boardId, identities, mru, t]);

  useEffect(() => {
    if (boardId === null) {
      return;
    }
    setCandidates(candidates);
  }, [boardId, candidates, setCandidates]);
}

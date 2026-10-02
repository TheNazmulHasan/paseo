import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { groupBoardVisibleAgents, type BoardVisibleAgents } from "@/boards/screen-helpers";
import type { Board } from "@/boards/types";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { ViewedTimelineSync } from "@/timeline/viewed-timeline-sync";

/** Keeps the previous array while the visible set is unchanged, so effects do not refire. */
function useStableVisibleAgents(next: BoardVisibleAgents[]): BoardVisibleAgents[] {
  const stable = useRef<BoardVisibleAgents[]>([]);
  const same =
    stable.current.length === next.length &&
    stable.current.every(
      (group, index) =>
        group.serverId === next[index]?.serverId &&
        group.agentIds.length === next[index].agentIds.length &&
        group.agentIds.every((agentId, i) => agentId === next[index]?.agentIds[i]),
    );
  if (!same) {
    stable.current = next;
  }
  return stable.current;
}

/**
 * Tells each host which agents a view has on screen, the way a workspace screen does for its
 * own panes: without it their timelines are never fetched or streamed and the chat spins
 * forever. Mount once per view. A view spans hosts, so the visible agents are grouped by host.
 */
export function useBoardVisibleAgents(board: Board, routeFocused: boolean): void {
  const sourceId = `board:${board.id}`;
  const visible = useStableVisibleAgents(
    useMemo(
      () => (routeFocused ? groupBoardVisibleAgents(board.layout.root, board.origins) : []),
      [board.layout.root, board.origins, routeFocused],
    ),
  );
  const syncs = useSessionStore(
    useShallow((state) =>
      visible.map((group) => state.sessions[group.serverId]?.viewedTimelineSync ?? null),
    ),
  );
  const applied = useRef(new Map<string, ViewedTimelineSync>());

  useEffect(() => {
    for (const group of visible) {
      for (const agentId of group.agentIds) {
        void getHostRuntimeStore()
          .prepareAgentTimeline(group.serverId, agentId)
          .catch(() => undefined);
      }
    }
  }, [visible]);

  useLayoutEffect(() => {
    const current = new Map<string, ViewedTimelineSync>();
    visible.forEach((group, index) => {
      const sync = syncs[index];
      if (sync) {
        current.set(group.serverId, sync);
        sync.replaceVisibleAgentIds(sourceId, group.agentIds);
      }
    });
    // A host that left the view (or reconnected with a new sync) must stop holding agents.
    for (const [serverId, sync] of applied.current) {
      if (current.get(serverId) !== sync) {
        sync.replaceVisibleAgentIds(sourceId, []);
      }
    }
    applied.current.clear();
    for (const [serverId, sync] of current) {
      applied.current.set(serverId, sync);
    }
  }, [sourceId, syncs, visible]);

  useEffect(() => {
    const appliedSyncs = applied.current;
    return () => {
      for (const sync of appliedSyncs.values()) {
        sync.replaceVisibleAgentIds(sourceId, []);
      }
    };
  }, [sourceId]);
}

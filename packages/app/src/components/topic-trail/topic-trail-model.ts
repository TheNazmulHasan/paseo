import type { TopicTrail } from "@getpaseo/protocol/topic-trail";
import { useSessionStore } from "@/stores/session-store";

/** Nazmul mod (topic-trail): reading a session's trail from the client store. */

export function useTopicTrail(serverId: string | null, agentId: string | null): TopicTrail | null {
  return useSessionStore((state) => {
    if (!serverId || !agentId) return null;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    const trail = agent?.topicTrail ?? null;
    return trail && trail.topics.length > 0 ? trail : null;
  });
}

export function useIsAgentRunning(serverId: string | null, agentId: string | null): boolean {
  return useSessionStore((state) => {
    if (!serverId || !agentId) return false;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent ? agent.status === "running" || agent.turn.phase !== "idle" : false;
  });
}

/** "Your move" is only true while the agent is waiting: hide it while the agent is working. */
export function selectVisibleYourMove(trail: TopicTrail | null, running: boolean): string | null {
  if (!trail || running) return null;
  return trail.yourMove && trail.yourMove.trim().length > 0 ? trail.yourMove : null;
}

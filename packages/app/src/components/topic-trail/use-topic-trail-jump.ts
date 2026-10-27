import { useEffect } from "react";
import { useTopicTrailJumpStore } from "@/stores/topic-trail-jump-store";

/**
 * Nazmul mod (topic-trail): called by the agent's chat view. Picks up a jump requested from the
 * strip for this agent, scrolls via the chat outline, and clears the request. A jump that
 * cannot be satisfied (message gone, history not loaded) does nothing: it must never throw.
 */
export function useTopicTrailJump({
  serverId,
  agentId,
  jumpToPrompt,
}: {
  serverId: string;
  agentId: string;
  jumpToPrompt: (seq: number) => void;
}): void {
  const request = useTopicTrailJumpStore((state) => state.request);
  useEffect(() => {
    if (!request || request.serverId !== serverId || request.agentId !== agentId) {
      return;
    }
    useTopicTrailJumpStore.getState().clearJump(request.nonce);
    try {
      jumpToPrompt(request.seq);
    } catch {
      // silent by design
    }
  }, [agentId, jumpToPrompt, request, serverId]);
}

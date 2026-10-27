/**
 * Nazmul mod (topic-trail): the strip under a pane's tabs lives outside the chat, but the chat
 * owns scrolling. A click on a topic leaves a one-shot request here; the AgentStreamView of that
 * agent picks it up, scrolls to the message, and clears it.
 */
import { create } from "zustand";

export interface TopicJumpRequest {
  serverId: string;
  agentId: string;
  seq: number;
  /** The timeline epoch the seq was recorded in; the chat tries the seq even if it changed. */
  epoch: string | null;
  /** Makes two clicks on the same topic two distinct requests. */
  nonce: number;
}

interface TopicTrailJumpState {
  request: TopicJumpRequest | null;
  requestJump: (input: Omit<TopicJumpRequest, "nonce">) => void;
  clearJump: (nonce: number) => void;
}

let nextNonce = 0;

export const useTopicTrailJumpStore = create<TopicTrailJumpState>((set) => ({
  request: null,
  requestJump: (input) => {
    nextNonce += 1;
    set({ request: { ...input, nonce: nextNonce } });
  },
  clearJump: (nonce) =>
    set((state) => (state.request?.nonce === nonce ? { request: null } : state)),
}));

import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import {
  HomeLayoutSchema,
  resolveSnoozeUntil,
  type HomeSnoozePreset,
} from "@getpaseo/protocol/home";

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { homeHub, type HomeHub } from "./home-hub.js";

/**
 * Nazmul mod (home-map): the one inbound message of the mod, `home.request`, answered with
 * `home.response` carrying the snapshot after the action. Returns undefined for any message that
 * is not ours, like the other session dispatchers.
 */

export interface HomeSessionHost {
  emit(message: SessionOutboundMessage): void;
}

const PRESETS = new Set<string>(["3h", "tomorrow", "nextweek"]);

/** An ISO time, or one of the presets the screen's Later menu uses. */
export function parseSnoozeUntil(value: unknown, now: Date = new Date()): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("until must be an ISO time, 3h, tomorrow, nextweek or null");
  }
  const text = value.trim();
  if (PRESETS.has(text)) return resolveSnoozeUntil(text as HomeSnoozePreset, now).toISOString();
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`"${text}" is not a time. Use an ISO time, 3h, tomorrow or nextweek.`);
  return new Date(time).toISOString();
}

export function dispatchHomeMessage(
  msg: SessionInboundMessage,
  host: HomeSessionHost,
  hub: HomeHub = homeHub,
): Promise<void> | undefined {
  if (msg.type !== "home.request") return undefined;
  return answer(msg, host, hub);
}

async function answer(
  msg: Extract<SessionInboundMessage, { type: "home.request" }>,
  host: HomeSessionHost,
  hub: HomeHub,
): Promise<void> {
  try {
    const service = hub.service();
    const input = msg.input;
    let snapshot;
    switch (msg.action) {
      case "get":
        snapshot = await service.getSnapshot();
        break;
      case "refresh":
        snapshot = await service.refresh({ wait: false });
        break;
      case "snooze":
        if (typeof input.agentId !== "string" || !input.agentId) throw new Error("agentId is required");
        snapshot = await service.snooze(input.agentId, parseSnoozeUntil(input.until));
        break;
      case "keep":
        if (typeof input.agentId !== "string" || !input.agentId) throw new Error("agentId is required");
        snapshot = await service.keep(input.agentId, input.keep !== false);
        break;
      case "recent": {
        const offset = Math.max(0, Math.floor(Number(input.offset ?? 0)) || 0);
        const limit = Math.min(50, Math.max(1, Math.floor(Number(input.limit ?? 10)) || 10));
        const recent = await service.recentClosed(offset, limit);
        host.emit({
          type: "home.response",
          payload: { requestId: msg.requestId, snapshot: null, recent, error: null },
        });
        return;
      }
      case "set_layout": {
        const layout = input.layout === null || input.layout === undefined
          ? null
          : HomeLayoutSchema.parse(input.layout);
        snapshot = await service.setLayout(layout);
        break;
      }
    }
    host.emit({
      type: "home.response",
      payload: { requestId: msg.requestId, snapshot, error: null },
    });
  } catch (error) {
    host.emit({
      type: "home.response",
      payload: { requestId: msg.requestId, snapshot: null, error: getErrorMessage(error) },
    });
  }
}

import { getErrorMessage } from "@getpaseo/protocol/error-utils";

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { appCommandBus, type AppCommandBus } from "./app-command-bus.js";
import type { ChiefCore, SearchSessionsInput } from "./chief-tools.js";
import { dispatchHomeMessage } from "../home/home-session.js"; // Nazmul mod (home-map)

export interface ChiefSessionHost {
  core: ChiefCore;
  emit(message: SessionOutboundMessage): void;
}

/**
 * Nazmul mod (chief): the two inbound messages of the mod. Returns undefined for any message that
 * is not ours, like the other session dispatchers, so `session.ts` needs a single `??` line.
 * - `app_command.result.request`: the app's answer to a pushed `app_command`.
 * - `chief.query.request`: `paseo chief states|search`, answered by the same core the tools use.
 */
export function dispatchChiefMessage(
  msg: SessionInboundMessage,
  host?: ChiefSessionHost,
  bus: AppCommandBus = appCommandBus,
): Promise<void> | undefined {
  if (msg.type === "app_command.result.request") {
    bus.handleResult(msg);
    return Promise.resolve();
  }
  if (msg.type === "chief.query.request" && host) {
    return answerQuery(msg, host);
  }
  // Nazmul mod (home-map): `home.request` rides the same dispatcher, so session.ts needs no new line.
  if (host) return dispatchHomeMessage(msg, host);
  return undefined;
}

async function answerQuery(
  msg: Extract<SessionInboundMessage, { type: "chief.query.request" }>,
  host: ChiefSessionHost,
): Promise<void> {
  try {
    if (msg.query === "search" && (typeof msg.input.query !== "string" || !msg.input.query.trim())) {
      throw new Error("query is required");
    }
    const result =
      msg.query === "states"
        ? await host.core.sessionStates(msg.input)
        : await host.core.searchSessions(msg.input as unknown as SearchSessionsInput);
    host.emit({
      type: "chief.query.response",
      payload: { requestId: msg.requestId, result, error: null },
    });
  } catch (error) {
    host.emit({
      type: "chief.query.response",
      payload: { requestId: msg.requestId, result: null, error: getErrorMessage(error) },
    });
  }
}

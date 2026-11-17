import { randomUUID } from "node:crypto";
import type {
  AppActionInfo,
  AppCommand,
  AppCommandAction,
  AppCommandResultRequest,
} from "@getpaseo/protocol/chief";

/**
 * Nazmul mod (chief): how an agent drives the desktop app.
 *
 * The daemon pushes `app_command` to every client subscribed to it (the app subscribes with the
 * rest of FORK_SESSION_EVENTS) and the app answers with `app_command.result.request`. The bus
 * matches the answer to the waiting tool call by `commandId`.
 *
 * One bus per daemon, held as a module singleton so the three places that touch it (the MCP
 * tools, the session's inbound dispatch and bootstrap) need no constructor plumbing through
 * WebSocketServer and Session. Tests build their own with `createAppCommandBus`.
 */

/** What the bus needs from a client session; `Session` satisfies it. */
export interface AppCommandSession {
  hasEventSubscriber(event: "app_command"): boolean;
  publish(message: { type: "app_command"; payload: AppCommand }): void;
}

export interface AppCommandResult {
  ok: boolean;
  error: string | null;
  actions?: AppActionInfo[];
}

export interface AppCommandOutcome {
  /** Clients the command was pushed to. Zero means no app was connected. */
  clients: number;
  /** The first app's answer, or null when none came back in time. */
  result: AppCommandResult | null;
}

export interface AppCommandBus {
  /** Gives the bus the live client sessions. Call once at startup. */
  bind(listSessions: () => readonly AppCommandSession[]): void;
  send(
    action: AppCommandAction,
    args: Record<string, unknown>,
    options?: { waitMs?: number },
  ): Promise<AppCommandOutcome>;
  /** Called by the session for each `app_command.result.request`. */
  handleResult(message: AppCommandResultRequest): void;
}

export const DEFAULT_APP_COMMAND_WAIT_MS = 5_000;

export function createAppCommandBus(): AppCommandBus {
  let listSessions: () => readonly AppCommandSession[] = () => [];
  const waiting = new Map<string, (result: AppCommandResult) => void>();

  return {
    bind(next) {
      listSessions = next;
    },

    async send(action, args, options) {
      const command: AppCommand = { id: randomUUID(), action, args };
      const subscribed = listSessions().filter((session) => session.hasEventSubscriber("app_command"));
      if (subscribed.length === 0) return { clients: 0, result: null };

      const answer = new Promise<AppCommandResult | null>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(command.id);
          resolve(null);
        }, options?.waitMs ?? DEFAULT_APP_COMMAND_WAIT_MS);
        waiting.set(command.id, (result) => {
          clearTimeout(timer);
          waiting.delete(command.id);
          resolve(result);
        });
      });
      for (const session of subscribed) {
        session.publish({ type: "app_command", payload: command });
      }
      return { clients: subscribed.length, result: await answer };
    },

    handleResult(message) {
      // The first answer wins; a second app's answer to the same command finds nobody waiting.
      waiting.get(message.commandId)?.({
        ok: message.ok,
        error: message.error ?? null,
        ...(message.data ? { actions: message.data.actions } : {}),
      });
    },
  };
}

export const appCommandBus: AppCommandBus = createAppCommandBus();

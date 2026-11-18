import type { HomeSnapshot } from "@getpaseo/protocol/home";

import type { HomeService } from "./home-service.js";

/**
 * Nazmul mod (home-map): where the three places that touch Home meet (the MCP tools, the session's
 * `home.request` dispatch and bootstrap) without constructor plumbing through WebSocketServer and
 * Session: one module singleton, like the chief mod's `appCommandBus`. Bootstrap binds the service
 * and the live client sessions; every change is pushed as `home_update` to the sessions that
 * subscribed to it (the app does, with the rest of FORK_SESSION_EVENTS).
 */

/** What the hub needs from a client session; `Session` satisfies it. */
export interface HomeSession {
  hasEventSubscriber(event: "home_update"): boolean;
  publish(message: { type: "home_update"; payload: HomeSnapshot }): void;
}

export interface HomeHub {
  bind(service: HomeService | null, listSessions: () => readonly HomeSession[]): void;
  /** The bound service; throws a plain message when Home is not running. */
  service(): HomeService;
  available(): boolean;
}

export function createHomeHub(): HomeHub {
  let bound: HomeService | null = null;
  let unsubscribe: (() => void) | null = null;
  return {
    bind(service, listSessions) {
      unsubscribe?.();
      unsubscribe = null;
      bound = service;
      if (!service) return;
      unsubscribe = service.subscribe((snapshot) => {
        for (const session of listSessions()) {
          if (session.hasEventSubscriber("home_update")) {
            session.publish({ type: "home_update", payload: snapshot });
          }
        }
      });
    },
    service() {
      if (!bound) throw new Error("Home is not running on this daemon.");
      return bound;
    },
    available() {
      return bound !== null;
    },
  };
}

export const homeHub: HomeHub = createHomeHub();

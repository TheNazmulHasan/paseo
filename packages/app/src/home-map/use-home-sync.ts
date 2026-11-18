import { useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostFeature } from "@/runtime/host-features";
import { useHomeDataStore } from "./home-data-store";
import { registerHomeFetcher } from "./refetch";

/** While Home is on screen each host is asked again this often, so closed-today and Chief's work stay current. */
export const HOME_POLL_MS = 60_000;

/**
 * Keeps one host's Home snapshot current: one `get` on every (re)connect, then the daemon's
 * `home_update` pushes (subscribed with the rest of `FORK_SESSION_EVENTS`), and a quiet re-fetch
 * every minute. The push is not sent on connect and may overtake a slow `get`, so a get that lands
 * after a push is dropped (see `useHomeDataStore`). Failures are logged and never block the screen:
 * a daemon without Home simply leaves its sessions on the computed fallbacks.
 */
export function useHomeHostSync(
  client: DaemonClient | null,
  serverId: string,
  isConnected: boolean,
): void {
  const supported = useHostFeature(serverId, "forkSessionEvents");
  useEffect(() => {
    if (!client || !supported) return;
    const store = useHomeDataStore.getState();
    const unsubscribe = client.on("home_update", (message) => {
      if (message.type !== "home_update") return;
      useHomeDataStore.getState().applyPush(serverId, message.payload);
    });
    let cancelled = false;
    const fetchNow = () => {
      if (!isConnected) return;
      const ticket = store.beginGet(serverId);
      client
        .homeRequest("get")
        .then((snapshot) => {
          if (!cancelled) useHomeDataStore.getState().applyGet(serverId, ticket, snapshot);
          return undefined;
        })
        .catch((error) => console.warn("[Home] could not read the Home snapshot", error));
    };
    fetchNow();
    const interval = setInterval(fetchNow, HOME_POLL_MS);
    const unregister = registerHomeFetcher(serverId, fetchNow);
    return () => {
      cancelled = true;
      clearInterval(interval);
      unregister();
      unsubscribe();
    };
  }, [client, isConnected, serverId, supported]);
}

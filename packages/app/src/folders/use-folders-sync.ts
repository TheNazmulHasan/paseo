import { useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFolderStore } from "@/folders/folder-store";
import { useHostFeature } from "@/runtime/host-features";

/**
 * Keeps the host's folder snapshot current: one list call on every (re)connect, then the daemon's
 * `folders_update` pushes (subscribed with the rest of `FORK_SESSION_EVENTS`). The push is not sent
 * on connect and may overtake a slow list reply, so a reply that lands after a push is dropped.
 */
export function useFoldersSync(
  client: DaemonClient | null,
  serverId: string,
  isConnected: boolean,
): void {
  const supported = useHostFeature(serverId, "folders");
  useEffect(() => {
    if (!client || !supported) return;
    let pushes = 0;
    const unsubscribe = client.on("folders_update", (message) => {
      if (message.type !== "folders_update") return;
      pushes += 1;
      useFolderStore.getState().setSnapshot(serverId, message.payload);
    });
    let cancelled = false;
    if (isConnected) {
      const pushesBefore = pushes;
      client
        .listFolders()
        .then((snapshot) => {
          if (!cancelled && pushes === pushesBefore) {
            useFolderStore.getState().setSnapshot(serverId, snapshot);
          }
          return undefined;
        })
        .catch((error) => console.warn("[Folders] could not list folders", error));
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, isConnected, serverId, supported]);
}

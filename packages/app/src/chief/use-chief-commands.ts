import { useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostFeature } from "@/runtime/host-features";
import { runChiefCommand } from "./chief-runtime";

/**
 * Nazmul mod (chief): answers `app_command` pushes (an agent driving the app through the daemon).
 * The push rides the fork session event subscription (`useForkSessionEvents`), so this only
 * listens. Every command gets an answer, success or the reason it failed, so the agent that sent
 * it is never left guessing.
 */
export function useChiefCommands(client: DaemonClient | null, serverId: string): void {
  const supported = useHostFeature(serverId, "forkSessionEvents");
  useEffect(() => {
    if (!client || !supported) return;
    return client.on("app_command", (message) => {
      if (message.type !== "app_command") return;
      const command = message.payload;
      void runChiefCommand(serverId, command).then((result) =>
        client.sendAppCommandResult({
          commandId: command.id,
          ok: result.ok,
          error: result.error,
          ...(result.actions ? { data: { actions: result.actions } } : {}),
        }),
      );
    });
  }, [client, serverId, supported]);
}

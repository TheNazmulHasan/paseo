import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHomeHostSync } from "./use-home-sync";

/** Keeps one host's Home snapshot current while Home is on screen. Renders nothing. */
export function HomeHostSync({ serverId }: { serverId: string }): null {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  useHomeHostSync(client, serverId, isConnected);
  return null;
}

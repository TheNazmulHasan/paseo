import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { useDeskStore } from "@/desk/desk-store";
import { useFolderIndex } from "@/folders/folder-store";
import {
  getHostRuntimeStore,
  isHostRuntimeDirectoryLoading,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { useHomeStore } from "./home-store";
import {
  buildHomeBands,
  buildHomeMap,
  buildHomeSessions,
  findChiefAgent,
  type HomeBands,
  type HomeFolderNode,
  type HomeSession,
} from "./model";

export interface HomeData {
  sessions: HomeSession[];
  bands: HomeBands;
  tree: HomeFolderNode[];
  /** The Chief agent (label `paseo.role=chief`), or null when none is set up. */
  chief: Agent | null;
  /** Some host is still loading its first directory and nothing has arrived yet. */
  loading: boolean;
}

/**
 * Home reads the app's live stores (the daemons push every change), so it updates with no polling.
 * Directory demand is held while Home is mounted, as every session list does, so the agents and
 * workspaces are loaded even when no other screen asked for them.
 */
export function useHomeData(): HomeData {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);

  useEffect(() => {
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [runtime, serverIds]);

  const loadingKey = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () =>
      serverIds
        .map((serverId) =>
          isHostRuntimeDirectoryLoading(runtime.getSnapshot(serverId)) ? "1" : "0",
        )
        .join(""),
    () => "",
  );

  const agentsByServer = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, Agent> | undefined> = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.agents;
      }
      return result;
    }),
  );
  const workspacesByServer = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, WorkspaceDescriptor> | undefined> = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.workspaces;
      }
      return result;
    }),
  );
  const folderIndex = useFolderIndex();
  const deskKeys = useDeskStore((state) => state.deskKeys);
  const showQuiet = useHomeStore((state) => state.showQuiet);

  const agents = useMemo(() => {
    const all: Agent[] = [];
    for (const map of Object.values(agentsByServer)) {
      if (map) all.push(...map.values());
    }
    return all;
  }, [agentsByServer]);
  const sessions = useMemo(
    () => buildHomeSessions({ agents, workspaces: workspacesByServer, folderIndex }),
    [agents, workspacesByServer, folderIndex],
  );
  const bands = useMemo(() => buildHomeBands(sessions), [sessions]);
  const tree = useMemo(
    () => buildHomeMap({ sessions, folderIndex, deskKeys, showQuiet }),
    [sessions, folderIndex, deskKeys, showQuiet],
  );
  const chief = useMemo(() => findChiefAgent(agents), [agents]);

  return {
    sessions,
    bands,
    tree,
    chief,
    loading: loadingKey.includes("1") && sessions.length === 0,
  };
}

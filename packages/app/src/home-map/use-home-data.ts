import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { buildHomeView } from "@getpaseo/protocol/home";
import { useFolderIndex } from "@/folders/folder-store";
import {
  getHostRuntimeStore,
  isHostRuntimeDirectoryLoading,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { useHomeDataStore } from "./home-data-store";
import { useHomeStore } from "./home-store";
import { buildHomeSessions, findChiefAgent, type HomeSession } from "./model";
import {
  localDayKey,
  mergeHomeSnapshots,
  resolveClosedToday,
  type MergedHomeSnapshot,
} from "./snapshots";
import type { HomeSessionView } from "./view-model";

export interface HomeData {
  view: HomeSessionView;
  sessions: HomeSession[];
  merged: MergedHomeSnapshot;
  closedToday: number;
  /** The clock the view was built at (ticks every 30 s). */
  now: number;
  /** The Chief agent (label `paseo.role=chief`), or null when none is set up. */
  chief: Agent | null;
  /** Some host is still loading its first directory and nothing has arrived yet. */
  loading: boolean;
}

/** Snoozes end by the clock, so the view is rebuilt this often even when nothing else changed. */
const CLOCK_TICK_MS = 30_000;

function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  return now;
}

/**
 * Home reads the app's live stores (the daemons push every change), the per-host Home snapshots
 * and one clock. Every open session goes through the shared `buildHomeView`, so the groups are the
 * ones Chief's `home_get` reports. Directory demand is held while Home is mounted, as every
 * session list does, so the agents and workspaces are loaded even when no other screen asked.
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
  const snapshots = useHomeDataStore((state) => state.snapshots);
  const closedTodayLocal = useHomeStore((state) => state.closedTodayLocal);
  const now = useClock();

  const agents = useMemo(() => {
    const all: Agent[] = [];
    for (const map of Object.values(agentsByServer)) {
      if (map) all.push(...map.values());
    }
    return all;
  }, [agentsByServer]);
  const chief = useMemo(() => findChiefAgent(agents), [agents]);
  const sessions = useMemo(
    () =>
      buildHomeSessions({
        agents,
        workspaces: workspacesByServer,
        folderIndex,
        // Chief has its own bar at the bottom; its chat is not a session to check on.
        excludeIds: chief ? new Set([`${chief.serverId}:${chief.id}`]) : undefined,
      }),
    [agents, workspacesByServer, folderIndex, chief],
  );
  const merged = useMemo(() => {
    const openByHost: Record<string, number> = {};
    for (const session of sessions) {
      openByHost[session.serverId] = (openByHost[session.serverId] ?? 0) + 1;
    }
    return mergeHomeSnapshots(snapshots, openByHost);
  }, [sessions, snapshots]);
  const view = useMemo(
    () => buildHomeView({ sessions, brief: merged.brief, state: merged.state, now }),
    [sessions, merged, now],
  );
  const closedToday = resolveClosedToday({
    merged: merged.closedToday,
    local: closedTodayLocal,
    today: localDayKey(new Date(now)),
  });

  return {
    view,
    sessions,
    merged,
    closedToday,
    now,
    chief,
    loading: loadingKey.includes("1") && sessions.length === 0,
  };
}

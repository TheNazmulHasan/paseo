import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  closedBelowOpen,
  closedNeeded,
  HOME_RECENT_LIMIT,
  HOME_RECENT_PAGE,
  pageRecent,
  type ClosedRecent,
  type RecentRow,
} from "./recent";
import type { HomeSessionEntry } from "./view-model";

interface HostProgress {
  /** Closed sessions of this host already received (the next request's offset). */
  loaded: number;
  hasMore: boolean;
}

export interface HomeRecent {
  rows: RecentRow[];
  canShowMore: boolean;
  showMore: () => void;
  /** A closed session was reopened: take it off the list and keep the offsets right. */
  dropClosed: (serverId: string, agentId: string) => void;
}

/**
 * "Recently worked on": `open` is every open session he wrote to, newest first. Closed sessions
 * are asked of each daemon (`home.request` action `recent`) only when the visible rows need them,
 * a page at a time. `resetKey` changes when something was closed or restored, which shifts the
 * daemon's list, so what was loaded is thrown away and fetched again.
 */
export function useHomeRecent(input: {
  open: readonly HomeSessionEntry[];
  serverIds: readonly string[];
  resetKey: string | number;
}): HomeRecent {
  const { open, serverIds, resetKey } = input;
  const [visible, setVisible] = useState(HOME_RECENT_LIMIT);
  const [closed, setClosed] = useState<ClosedRecent[]>([]);
  const [hosts, setHosts] = useState<Record<string, HostProgress>>({});
  const inflight = useRef(false);
  const generation = useRef(0);
  const lastResetKey = useRef(resetKey);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    generation.current += 1;
    setClosed([]);
    setHosts({});
  }, [resetKey]);

  const openKeys = useMemo(() => new Set(open.map((entry) => entry.session.id)), [open]);
  const closedShown = useMemo(() => closedBelowOpen(closed, openKeys), [closed, openKeys]);
  const need = closedNeeded({
    visible,
    openCount: open.length,
    closedLoaded: closedShown.length,
  });

  useEffect(() => {
    if (need <= 0 || inflight.current) return;
    const todo = serverIds.filter((serverId) => hosts[serverId]?.hasMore !== false);
    if (todo.length === 0) return;
    const gen = generation.current;
    inflight.current = true;
    const runtime = getHostRuntimeStore();
    void Promise.all(
      todo.map(async (serverId) => {
        const client = runtime.getClient(serverId);
        if (!client) return null;
        const offset = hosts[serverId]?.loaded ?? 0;
        try {
          const page = await client.homeRecent(offset, HOME_RECENT_PAGE);
          return { serverId, offset, page };
        } catch (error) {
          console.warn("[Home] could not read closed sessions", error);
          return { serverId, offset, page: { items: [], hasMore: false } };
        }
      }),
    ).then((results) => {
      inflight.current = false;
      if (gen !== generation.current) {
        // A reset happened while this ran: ask again for the fresh state.
        setTick((value) => value + 1);
        return;
      }
      const fetched = results.filter((result) => result !== null);
      if (fetched.length === 0) return;
      setClosed((current) => [
        ...current,
        ...fetched.flatMap(({ serverId, page }) => page.items.map((item) => ({ ...item, serverId }))),
      ]);
      setHosts((current) => {
        const next = { ...current };
        for (const { serverId, offset, page } of fetched) {
          next[serverId] = { loaded: offset + page.items.length, hasMore: page.hasMore };
        }
        return next;
      });
      return undefined;
    });
  }, [need, serverIds, hosts, tick]);

  const moreOnDaemon = serverIds.some((serverId) => hosts[serverId]?.hasMore !== false);
  const { rows, canShowMore } = useMemo(
    () => pageRecent({ open, closed, visible, moreOnDaemon }),
    [open, closed, visible, moreOnDaemon],
  );
  const showMore = useCallback(() => setVisible((value) => value + HOME_RECENT_PAGE), []);
  const dropClosed = useCallback((serverId: string, agentId: string) => {
    setClosed((current) =>
      current.filter((item) => !(item.serverId === serverId && item.agentId === agentId)),
    );
    setHosts((current) => {
      const host = current[serverId];
      return host ? { ...current, [serverId]: { ...host, loaded: Math.max(0, host.loaded - 1) } } : current;
    });
  }, []);

  return { rows, canShowMore, showMore, dropClosed };
}

import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveSnoozeUntil,
  type HomeSnapshot,
  type HomeSnoozePreset,
} from "@getpaseo/protocol/home";
import { useToast } from "@/contexts/toast-api-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import {
  createUndoLedger,
  planClose,
  runBatch,
  UNDO_WINDOW_MS,
  type CloseTarget,
} from "./close-actions";
import { useHomeDataStore } from "./home-data-store";
import { useHomeStore } from "./home-store";
import { sessionLabel, type HomeSession } from "./model";
import { requestHomeRefetch } from "./refetch";
import { hostsWithLayout, localDayKey } from "./snapshots";
import { UndoToast } from "./undo-toast";
import { openHomeSession } from "./open-session";

export interface HomeActions {
  open: (session: HomeSession) => void;
  /** Archives the sessions (one Undo toast for the batch). */
  close: (sessions: readonly HomeSession[]) => Promise<void>;
  snooze: (session: HomeSession, preset: HomeSnoozePreset) => Promise<void>;
  unsnooze: (session: HomeSession) => Promise<void>;
  keep: (session: HomeSession) => Promise<void>;
  refresh: () => Promise<void>;
  backToNormal: () => Promise<void>;
}

function clientFor(serverId: string, disconnectedMessage: string) {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) throw new Error(disconnectedMessage);
  return client;
}

/**
 * Everything a button on Home does. Close is the existing archive with a 10 second Undo (the
 * session comes back with `refreshAgent`, the same call as the archived-chat banner). The other
 * actions go to the session's own host through `homeRequest`; each reply is the full new snapshot,
 * applied at once, so the screen does not wait for the push.
 */
export function useHomeActions(): HomeActions {
  const { t } = useTranslation();
  const toast = useToast();
  const ledger = useMemo(() => createUndoLedger(UNDO_WINDOW_MS), []);
  const dismissRef = useRef<(() => void) | null>(null);
  const disconnected = t("workspace.terminal.hostDisconnected");

  const reportError = useCallback(
    (error: unknown) => toast.error(`${t("homeMap.toasts.failed")}: ${toErrorMessage(error)}`),
    [t, toast],
  );

  const open = useCallback((session: HomeSession) => {
    if (!session.workspaceId) return;
    openHomeSession({
      serverId: session.serverId,
      workspaceId: session.workspaceId,
      agentId: session.agentId,
    });
  }, []);

  const undo = useCallback(async () => {
    dismissRef.current?.();
    const targets = ledger.take(Date.now());
    if (targets.length === 0) return;
    const { done, failed } = await runBatch(targets, async (target: CloseTarget) => {
      await clientFor(target.serverId, disconnected).refreshAgent(target.agentId);
    });
    if (done.length > 0) {
      useHomeStore.getState().recordClosed(-done.length, localDayKey(new Date()));
      requestHomeRefetch();
    }
    if (failed.length > 0) toast.error(t("homeMap.toasts.undoFailed", { count: failed.length }));
  }, [disconnected, ledger, t, toast]);

  const close = useCallback(
    async (sessions: readonly HomeSession[]) => {
      const targets = planClose(sessions);
      if (targets.length === 0) return;
      const { done, failed } = await runBatch(targets, async (target) => {
        await clientFor(target.serverId, disconnected).archiveAgent(target.agentId);
      });
      if (failed.length > 0) toast.error(t("homeMap.toasts.closeFailed", { count: failed.length }));
      if (done.length === 0) return;
      useHomeStore.getState().recordClosed(done.length, localDayKey(new Date()));
      const undoable = ledger.record(done, Date.now());
      requestHomeRefetch();
      const only =
        undoable.length === 1 ? sessions.find((s) => s.agentId === undoable[0].agentId) : null;
      const message =
        undoable.length === 1
          ? t("homeMap.toasts.closedOne", {
              title: (only ? sessionLabel(only) : null) ?? t("homeMap.untitled"),
            })
          : t("homeMap.toasts.closedMany", { count: undoable.length });
      dismissRef.current = toast.show(<UndoToast message={message} onUndo={undo} />, {
        durationMs: UNDO_WINDOW_MS,
        testID: "home-undo-toast",
      });
    },
    [disconnected, ledger, t, toast, undo],
  );

  const applySnapshot = useCallback(
    async (session: HomeSession, run: () => Promise<HomeSnapshot>) => {
      try {
        const snapshot = await run();
        useHomeDataStore.getState().applyPush(session.serverId, snapshot);
      } catch (error) {
        reportError(error);
      }
    },
    [reportError],
  );

  const snooze = useCallback(
    (session: HomeSession, preset: HomeSnoozePreset) =>
      applySnapshot(session, () =>
        clientFor(session.serverId, disconnected).homeRequest("snooze", {
          agentId: session.agentId,
          until: resolveSnoozeUntil(preset, new Date()).toISOString(),
        }),
      ),
    [applySnapshot, disconnected],
  );

  const unsnooze = useCallback(
    (session: HomeSession) =>
      applySnapshot(session, () =>
        clientFor(session.serverId, disconnected).homeRequest("snooze", {
          agentId: session.agentId,
          until: null,
        }),
      ),
    [applySnapshot, disconnected],
  );

  const keep = useCallback(
    (session: HomeSession) =>
      applySnapshot(session, () =>
        clientFor(session.serverId, disconnected).homeRequest("keep", {
          agentId: session.agentId,
          keep: true,
        }),
      ),
    [applySnapshot, disconnected],
  );

  const refresh = useCallback(async () => {
    const serverIds = Object.keys(useHomeDataStore.getState().snapshots);
    const outcomes = await Promise.allSettled(
      serverIds.map(async (serverId) => {
        const snapshot = await clientFor(serverId, disconnected).homeRequest("refresh");
        useHomeDataStore.getState().applyPush(serverId, snapshot);
      }),
    );
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure && failure.status === "rejected") reportError(failure.reason);
  }, [disconnected, reportError]);

  const backToNormal = useCallback(async () => {
    const snapshots = useHomeDataStore.getState().snapshots;
    const serverIds = hostsWithLayout(snapshots);
    const outcomes = await Promise.allSettled(
      serverIds.map(async (serverId) => {
        const snapshot = await clientFor(serverId, disconnected).homeRequest("set_layout", {
          layout: null,
        });
        useHomeDataStore.getState().applyPush(serverId, snapshot);
      }),
    );
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure && failure.status === "rejected") reportError(failure.reason);
  }, [disconnected, reportError]);

  return useMemo(
    () => ({ open, close, snooze, unsnooze, keep, refresh, backToNormal }),
    [open, close, snooze, unsnooze, keep, refresh, backToNormal],
  );
}

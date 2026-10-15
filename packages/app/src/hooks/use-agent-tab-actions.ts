import { useCallback, useMemo } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildProviderCommand } from "@/utils/provider-command-templates";

/**
 * Copies the FULL agent id, bare (no title, no short form). Agents act on ids, so this is what
 * the user pastes into another session.
 */
export function useCopyAgentId(): (agentId: string | null) => Promise<void> {
  const { t } = useTranslation();
  const toast = useToast();
  return useCallback(
    async (agentId: string | null) => {
      if (!agentId) return;
      try {
        await Clipboard.setStringAsync(agentId);
        toast.copied(t("workspace.tabs.toasts.agentIdCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );
}

export interface AgentTabActions {
  copyAgentId: (agentId: string) => Promise<void>;
  copyFilePath: (path: string) => Promise<void>;
  copyResumeCommand: (agentId: string) => Promise<void>;
  reloadAgent: (agentId: string) => Promise<void>;
}

/**
 * The per-tab agent actions the tab context menu offers, for surfaces that are not a workspace
 * screen (Views tabs). They mirror the workspace screen's handlers and are bound to one host.
 */
export function useAgentTabActions(serverId: string): AgentTabActions {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const copyAgentId = useCopyAgentId();

  const copyFilePath = useCallback(
    async (path: string) => {
      if (!path) return;
      try {
        await Clipboard.setStringAsync(path);
        toast.copied(t("workspace.tabs.toasts.filePathCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );

  const copyResumeCommand = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId) ?? null;
      const providerSessionId =
        agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
      if (!agent || !providerSessionId) {
        toast.error(t("workspace.tabs.toasts.resumeIdUnavailable"));
        return;
      }
      const command =
        buildProviderCommand({
          provider: agent.provider,
          id: "resume",
          sessionId: providerSessionId,
        }) ?? null;
      if (!command) {
        toast.error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
        return;
      }
      try {
        await Clipboard.setStringAsync(command);
        toast.copied(t("workspace.tabs.toasts.resumeCommandCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [serverId, toast, t],
  );

  const reloadAgent = useCallback(
    async (agentId: string) => {
      if (!client || !isConnected) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      toast.show(t("workspace.tabs.toasts.reloadingAgent"), { durationMs: null });
      try {
        await client.refreshAgent(agentId);
        // Send the existing cursor so the server detects the new epoch and returns reset:true
        // (same reason as the workspace screen's reload).
        const sessionState = useSessionStore.getState().sessions[serverId];
        const currentCursor = sessionState?.agentTimelineCursor.get(agentId);
        await getHostRuntimeStore().fetchAgentTimeline(serverId, agentId, {
          direction: "tail",
          projection: "projected",
          ...(currentCursor
            ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
            : {}),
        });
        toast.show(t("workspace.tabs.toasts.reloadedAgent"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToReloadAgent"),
        );
      }
    },
    [client, isConnected, serverId, toast, t],
  );

  return useMemo(
    () => ({ copyAgentId, copyFilePath, copyResumeCommand, reloadAgent }),
    [copyAgentId, copyFilePath, copyResumeCommand, reloadAgent],
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { formatBacklogTaskWorkspacePrompt } from "@getpaseo/protocol/tasks/prompt";
import type { UserComposerAttachment } from "@/attachments/types";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useProjects } from "@/hooks/use-projects";
import { generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import {
  annotateMasterBacklogTasks,
  fetchMasterBacklogTasks,
  sortMasterBacklogTasks,
  type MasterBacklogTask,
} from "@/tasks/master-backlog";
import { useToast } from "@/contexts/toast-api-context";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { buildNewWorkspaceDraftKey } from "@/utils/new-workspace-draft";
import { toErrorMessage } from "@/utils/error-messages";
import { HOME_POLL_MS } from "./use-home-sync";

export interface HomeBacklog {
  /** Hosts can list a backlog at all; when false the whole block is hidden. */
  available: boolean;
  /** Active tasks, newest update first. */
  tasks: MasterBacklogTask[];
  startingKey: string | null;
  start: (task: MasterBacklogTask) => Promise<void>;
}

/** The task's attachments as files the new workspace's composer starts with. */
async function buildAttachments(
  task: MasterBacklogTask,
  requestToken: (attachmentId: string) => Promise<{ path: string | null; error: string | null }>,
): Promise<UserComposerAttachment[]> {
  const attachments: UserComposerAttachment[] = [];
  for (const attachment of task.attachments) {
    const reference = await requestToken(attachment.id);
    if (!reference.path) {
      throw new Error(reference.error ?? `Failed to attach ${attachment.fileName}`);
    }
    attachments.push({
      kind: "file",
      attachment: {
        type: "uploaded_file",
        id: `task_${task.id}_${attachment.id}`,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        path: reference.path,
      },
    });
  }
  return attachments;
}

/**
 * Not started: the Paseo backlog's active tasks. Start does what "Create workspace" does on the
 * backlog screen: the task's prompt (and files) go into a new-workspace draft and the New
 * workspace screen opens on it, so nothing starts until he presses send there. A host without a
 * backlog contributes nothing; with no such host the block is hidden.
 */
export function useHomeBacklog(): HomeBacklog {
  const { t } = useTranslation();
  const toast = useToast();
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const { projects } = useProjects();
  const allServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsByServerId = useHostFeatureMap(allServerIds, "taskBacklogListAll");
  const supportedHosts = useMemo(
    () =>
      hosts
        .filter((host) => supportsByServerId.get(host.serverId))
        .map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts, supportsByServerId],
  );
  const [hostTasks, setHostTasks] = useState<
    Awaited<ReturnType<typeof fetchMasterBacklogTasks>>["hostTasks"]
  >([]);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  useEffect(() => {
    if (supportedHosts.length === 0) {
      setHostTasks([]);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      fetchMasterBacklogTasks({ hosts: supportedHosts, runtime })
        .then((result) => {
          if (!cancelled) setHostTasks(result.hostTasks);
          return undefined;
        })
        .catch(() => undefined);
    };
    load();
    const interval = setInterval(load, HOME_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runtime, supportedHosts]);

  const tasks = useMemo(
    () =>
      sortMasterBacklogTasks(annotateMasterBacklogTasks({ hostTasks, projects })).filter(
        (task) => task.status === "active",
      ),
    [hostTasks, projects],
  );

  const start = useCallback(
    async (task: MasterBacklogTask) => {
      setStartingKey(task.taskKey);
      try {
        const client = runtime.getClient(task.serverId);
        if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
        const attachments = await buildAttachments(task, (attachmentId) =>
          client.requestTaskAttachmentDownloadToken({
            projectId: task.projectId,
            taskId: task.id,
            attachmentId,
          }),
        );
        const draftId = generateDraftId();
        useDraftStore.getState().saveDraftInput({
          draftKey: buildNewWorkspaceDraftKey({
            selectedServerId: task.serverId,
            selectedSourceDirectory: null,
            draftId,
          }),
          draft: { text: formatBacklogTaskWorkspacePrompt(task), attachments },
        });
        router.navigate(
          buildNewWorkspaceRoute({
            serverId: task.serverId,
            projectId: task.projectId,
            displayName: task.projectName,
            draftId,
          }) as Href,
        );
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setStartingKey(null);
      }
    },
    [runtime, t, toast],
  );

  return { available: supportedHosts.length > 0, tasks, startingKey, start };
}

import { useMemo } from "react";
import { useDeskStore } from "@/desk/desk-store";
import { toKeySet } from "@/desk/model";
import { useProjects } from "@/hooks/use-projects";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { orderPickerWorkspaces, type PickerWorkspace } from "@/boards/workspace-picker-model";

/**
 * Every workspace on every host, the way the Hyper+J switcher lists them (project icon and
 * workspace name), ordered current first, then the Desk, then the rest. Subscribes only while the
 * picker is open.
 */
export function useSplitPickerWorkspaces(input: {
  enabled: boolean;
  currentKey: string | null;
}): readonly PickerWorkspace[] {
  const { enabled, currentKey } = input;
  const { workspacePlacements } = useSidebarWorkspacesList({ enabled });
  const { projects } = useProjects({ enabled });
  const deskKeyList = useDeskStore((state) => state.deskKeys);
  const deskKeys = useMemo(() => toKeySet(deskKeyList), [deskKeyList]);

  const iconTargets = useMemo<ProjectIconTarget[]>(
    () =>
      projects.flatMap((project) =>
        project.hosts.flatMap((host) => {
          const target = createProjectIconTarget({
            projectViewKey: project.viewKey,
            placement: { ...host, iconWorkingDir: host.repoRoot },
          });
          return target ? [target] : [];
        }),
      ),
    [projects],
  );
  const iconDataByProjectViewKey = useProjectIcons({ projects: iconTargets });

  const titleByKey = useMemo(() => {
    const titles = new Map<string, string>();
    for (const project of projects) {
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          titles.set(`${host.serverId}:${workspace.id}`, workspace.title ?? workspace.name);
        }
      }
    }
    return titles;
  }, [projects]);

  return useMemo(() => {
    const items: PickerWorkspace[] = workspacePlacements.map((workspace) => ({
      key: workspace.workspaceKey,
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      title: titleByKey.get(workspace.workspaceKey) ?? workspace.name,
      projectName: workspace.projectName,
      projectViewKey: workspace.projectViewKey,
      initial: projectIconPlaceholderLabelFromDisplayName(workspace.projectName),
      iconDataUri: iconDataByProjectViewKey.get(workspace.projectViewKey) ?? null,
    }));
    return orderPickerWorkspaces(items, { currentKey, deskKeys });
  }, [currentKey, deskKeys, iconDataByProjectViewKey, titleByKey, workspacePlacements]);
}

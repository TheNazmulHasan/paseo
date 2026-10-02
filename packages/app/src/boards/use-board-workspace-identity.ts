import { useMemo } from "react";
import { useProjects } from "@/hooks/use-projects";
import { boardWorkspaceKey } from "@/boards/screen-helpers";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";

/** What a pane header and a tab chip show about the workspace a session lives in. */
export interface BoardWorkspaceIdentity {
  workspaceName: string;
  projectViewKey: string;
  initial: string;
  iconDataUri: string | null;
}

export type BoardWorkspaceIdentityMap = ReadonlyMap<string, BoardWorkspaceIdentity>;

/**
 * Workspace name and project icon for every workspace on every host, keyed `serverId:workspaceId`.
 * Same sources as the workspace switcher, read once for the whole board instead of per tab.
 */
export function useBoardWorkspaceIdentities(): BoardWorkspaceIdentityMap {
  const { projects } = useProjects({ enabled: true });

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

  return useMemo(() => {
    const identities = new Map<string, BoardWorkspaceIdentity>();
    for (const project of projects) {
      const initial = projectIconPlaceholderLabelFromDisplayName(project.projectName);
      const iconDataUri = iconDataByProjectViewKey.get(project.viewKey) ?? null;
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          identities.set(
            boardWorkspaceKey({ serverId: host.serverId, workspaceId: workspace.id }),
            {
              workspaceName: workspace.title ?? workspace.name,
              projectViewKey: project.viewKey,
              initial,
              iconDataUri,
            },
          );
        }
      }
    }
    return identities;
  }, [iconDataByProjectViewKey, projects]);
}

/** Used while the workspace is not (yet) known, for example its host is offline. */
export function fallbackBoardWorkspaceIdentity(workspaceId: string): BoardWorkspaceIdentity {
  const name = projectIconPlaceholderLabelFromDisplayName(workspaceId);
  return {
    workspaceName: name || workspaceId,
    projectViewKey: workspaceId,
    initial: name,
    iconDataUri: null,
  };
}

import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode, SidebarProjectSortMode } from "@/stores/sidebar-view-store";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";
import {
  buildDeskGroups,
  buildDeskRows,
  flattenDeskGroups,
  splitDeskFromProjects,
  type DeskGroup,
  type DeskGrouping,
} from "@/desk/model";

const NO_DESK_KEYS: ReadonlySet<string> = new Set();

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  /** Fork mod #12: the Desk, grouped as the Desk's own toggle says. Its rows left the Shelf. */
  deskGroups: DeskGroup[];
  /** Workspaces left on the Shelf (neither pinned nor on the Desk). */
  shelfCount: number;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers. It used to be derived in the
   * list, under a `groupMode === "status"` gate written when status was the only mode that put
   * icons on rows.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
}

export interface SidebarProjectionInput {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  /** Absent means manual: the pinned section keeps its pinned-at + drag order. */
  projectSort?: SidebarProjectSortMode;
  pinnedCollapsed: boolean;
  /** Fork mod #12; absent means an empty Desk, collapsed Shelf off. */
  deskKeys?: ReadonlySet<string>;
  deskGrouping?: DeskGrouping;
  shelfCollapsed?: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedSplit = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
    sortMode: input.projectSort,
    workspaceEntriesByKey: input.workspaceEntriesByKey,
  });
  // Pinned wins, then Desk, then the Shelf: `unpinnedProjects` loses the Desk rows here.
  const deskKeys = input.deskKeys ?? NO_DESK_KEYS;
  const deskSplit = splitDeskFromProjects(pinnedSplit.unpinnedProjects, deskKeys);
  const pinnedGroups =
    deskSplit.shelfProjects === pinnedSplit.unpinnedProjects
      ? pinnedSplit
      : { ...pinnedSplit, unpinnedProjects: deskSplit.shelfProjects };
  const deskGroups = buildDeskGroups({
    rows: buildDeskRows({
      deskPlacements: deskSplit.deskPlacements,
      workspaceEntriesByKey: input.workspaceEntriesByKey,
    }),
    grouping: input.deskGrouping ?? "recent",
    projectNamesByViewKey: input.projectNamesByViewKey,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const unpinnedWorkspaces = Array.from(input.workspaceEntriesByKey.values()).filter(
    (workspace) =>
      !pinnedWorkspaceKeys.has(workspace.workspaceKey) && !deskKeys.has(workspace.workspaceKey),
  );
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the project rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaces);

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  sections.push({ workspaces: flattenDeskGroups(deskGroups) });
  if (input.groupMode === "project") {
    sections.push(
      ...pinnedGroups.unpinnedProjects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.shelfCollapsed || input.collapsedProjectKeys.has(project.viewKey),
      })),
    );
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.shelfCollapsed || input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    deskGroups,
    shelfCount: deskSplit.shelfCount,
    workspaceGroups,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/** Project mode keeps its project headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status":
      return statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey),
      );
  }
}

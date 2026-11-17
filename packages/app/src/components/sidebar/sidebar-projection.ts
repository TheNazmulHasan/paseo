import type { TFunction } from "i18next";
import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import { sortSidebarWorkspacesByRecentActivity } from "@/hooks/sidebar-workspaces-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceSort } from "@/projects/workspace-structure";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
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
import type { BoardSummary } from "@/boards/types";
import {
  buildFolderSections,
  buildFolderShortcutSections,
  UNFILED_FOLDER_KEY,
  type FolderIndex,
  type FolderSection,
} from "@/folders/model";
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
  /** Fork mod #12: the Desk (the first folder of Folders), grouped as its own toggle says. Its rows left the Shelf. */
  deskGroups: DeskGroup[];
  /** Workspaces left on the Shelf (neither pinned nor on the Desk). */
  shelfCount: number;
  /** Fork mod #16: the Folders section that replaces the Shelf. Null = no folders, Shelf as before. */
  folderSections: FolderSection<SidebarWorkspaceEntry, BoardSummary>[] | null;
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
  /** Only "recent" changes the pinned section; anything else keeps its pinned-at + drag order. */
  workspaceSort?: WorkspaceSort;
  pinnedCollapsed: boolean;
  /** Fork mod #12; absent means an empty Desk, collapsed Shelf off. */
  deskKeys?: ReadonlySet<string>;
  deskGrouping?: DeskGrouping;
  shelfCollapsed?: boolean;
  deskCollapsed?: boolean;
  /** Fork mod #16; absent means no folders, so the Shelf renders and numbers as before. */
  folders?: {
    index: FolderIndex;
    /** The saved views. */
    boards: readonly BoardSummary[];
    openKeys: ReadonlySet<string>;
  };
  /**
   * The whole Folders section is folded. The Desk is its first folder, so folding it hides the Desk
   * too, with or without user folders (a sidebar whose hosts have none still draws the Desk).
   */
  foldersSectionCollapsed?: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  t: TFunction;
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedSplit = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
    sortMode: input.workspaceSort,
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
    t: input.t,
    folders: input.folders && {
      folders: input.folders.index.groups.map((group) => ({
        key: group.key,
        label: group.emoji ? `${group.emoji} ${group.name}` : group.name,
      })),
      keyByWorkspaceKey: input.folders.index.workspaceFolderKey,
      unfiled: { key: UNFILED_FOLDER_KEY, label: input.t("folders.unfiled") },
    },
  });
  let folderSections = input.folders
    ? buildFolderSections({
        index: input.folders.index,
        boards: input.folders.boards,
        workspaces: sortSidebarWorkspacesByRecentActivity({
          workspaces: Array.from(input.workspaceEntriesByKey.values()),
          workspaceEntriesByKey: input.workspaceEntriesByKey,
        }),
      })
    : null;
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
  // The Desk is the first folder of the Folders section: folded away with the section, or on its own.
  const foldersSectionCollapsed = input.foldersSectionCollapsed ?? false;
  const deskHidden = Boolean(input.deskCollapsed) || foldersSectionCollapsed;
  sections.push({
    workspaces: flattenDeskGroups(deskGroups),
    collapsed: deskHidden,
  });
  if (input.folders && folderSections) {
    // The folders replace the Shelf. Pinned and Desk rows repeat in their folder; they are
    // numbered once, at their first visible place.
    const alreadyNumbered = new Set<string>();
    if (!input.pinnedCollapsed) {
      for (const workspace of pinnedGroups.pinnedChats) alreadyNumbered.add(workspace.workspaceKey);
    }
    if (!deskHidden) {
      for (const workspace of flattenDeskGroups(deskGroups)) {
        alreadyNumbered.add(workspace.workspaceKey);
      }
    }
    const folderShortcutSections = buildFolderShortcutSections({
      sections: folderSections,
      openKeys: input.folders.openKeys,
      sectionCollapsed: foldersSectionCollapsed,
      alreadyNumbered,
    });
    sections.push(...folderShortcutSections);
    folderSections = folderSections.map((section, index) => ({
      ...section,
      numberedKeys: new Set(
        (folderShortcutSections[index]?.workspaces ?? []).map(
          (workspace) => workspace.workspaceKey,
        ),
      ),
    }));
  } else if (input.groupMode === "project") {
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
    folderSections,
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
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey, input.t),
      );
  }
}

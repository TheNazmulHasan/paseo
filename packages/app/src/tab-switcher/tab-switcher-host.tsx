import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { ProjectIconView } from "@/components/project-icon-view";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import { isWeb } from "@/constants/platform";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import {
  cancelTabSwitcher,
  commitTabSwitcher,
  cycleTabSwitcher,
  handleTabSwitcherKeyEvent,
  isTabSwitcherPointerSelectionAllowed,
  noteTabSwitcherPointerMoved,
  selectTabSwitcherIndex,
} from "@/tab-switcher/controller";
import { mergeRecentOrder, TAB_SWITCHER_VISIBLE_LIMIT } from "@/tab-switcher/model";
import { useTabSwitcherMruStore } from "@/tab-switcher/mru-store";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { visitKey, type TabSwitcherVisit } from "@/tab-switcher/model";
import { shortenPath } from "@/utils/shorten-path";

/** Big enough to recognise a mark at a glance, small enough not to lead the row. */
const TAB_SWITCHER_ICON_SIZE = 22;

/** Tab bars show a file by its name, not its path — so does the switcher. */
function fileNameFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** How far the mouse must travel before a hover counts as a deliberate choice. */
const POINTER_INTENT_THRESHOLD_PX = 6;

/**
 * Arc-style most-recently-used tab switcher.
 *
 * Two jobs, both global so they survive workspace changes:
 *  - `useVisitRecorder` remembers which chat is on screen, newest first.
 *  - `TabSwitcherOverlay` shows that list while the switcher key is being tapped.
 *
 * Mounted once from `app/_layout.tsx`.
 */
export function TabSwitcherHost() {
  useVisitRecorder();
  useCandidateSync();
  return <TabSwitcherOverlay />;
}

/**
 * Record the agent chat currently on screen. Derived from the active workspace
 * plus that workspace's focused pane, so it fires for every way a chat can come
 * to the front — tab click, sidebar click, shortcut, or the switcher itself.
 */
function useVisitRecorder(): void {
  const selection = useActiveWorkspaceSelection();
  const persistenceKey = selection
    ? buildWorkspaceTabPersistenceKey({
        serverId: selection.serverId,
        workspaceId: selection.workspaceId,
      })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    persistenceKey ? (state.layoutByWorkspace[persistenceKey] ?? null) : null,
  );
  const visit = useTabSwitcherMruStore((state) => state.visit);

  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;

  // A chat and an open file are both just tabs in the same bar, and Nazmul works
  // by flicking between the two, so both are recorded.
  const activeVisit = useMemo<Omit<TabSwitcherVisit, "at"> | null>(() => {
    if (!layout || !serverId) {
      return null;
    }
    const paneState = deriveWorkspacePaneState({ layout, tabs: collectAllTabs(layout.root) });
    const target = paneState.activeTab?.descriptor.target ?? null;
    if (target?.kind === "agent") {
      return { kind: "agent", serverId, agentId: target.agentId };
    }
    if (target?.kind === "file" && workspaceId) {
      return { kind: "file", serverId, workspaceId, path: target.path };
    }
    return null;
  }, [layout, serverId, workspaceId]);

  // Identity, not object identity — the memo above rebuilds on every layout tick.
  const activeVisitKey = activeVisit
    ? visitKey({ ...activeVisit, at: 0 } as TabSwitcherVisit)
    : null;
  const activeVisitRef = useRef(activeVisit);
  activeVisitRef.current = activeVisit;
  useEffect(() => {
    const current = activeVisitRef.current;
    if (current) {
      visit(current);
    }
  }, [activeVisitKey, visit]);
}

/**
 * Resolve the stored visit list against live agents and keep it on the switcher
 * store. Frozen while the switcher is open — the store ignores updates then, so
 * the list never reorders under the user's fingers mid-cycle.
 */
function useCandidateSync(): void {
  const { t } = useTranslation();
  const history = useTabSwitcherMruStore((state) => state.history);
  const { agents } = useAggregatedAgents({ demand: false });
  const { projects } = useProjects({ enabled: true });
  const setCandidates = useTabSwitcherStore((state) => state.setCandidates);
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);

  /**
   * Every file tab currently open, across every workspace.
   *
   * Unlike an agent there is no directory to ask — a file tab exists only inside
   * its workspace's layout. That store is global, so one sweep finds them all, and
   * a tab missing from it is one that was closed and must drop off the list.
   */
  const openFileTabs = useMemo(() => {
    const byKey = new Map<
      string,
      { serverId: string; workspaceId: string; path: string; createdAt: number }
    >();
    for (const [workspaceKey, layout] of Object.entries(layoutByWorkspace)) {
      if (!layout) {
        continue;
      }
      const separator = workspaceKey.indexOf(":");
      if (separator <= 0) {
        continue;
      }
      const serverId = workspaceKey.slice(0, separator);
      const workspaceId = workspaceKey.slice(separator + 1);
      for (const tab of collectAllTabs(layout.root)) {
        if (tab.target.kind !== "file") {
          continue;
        }
        const entry = { serverId, workspaceId, path: tab.target.path, createdAt: tab.createdAt };
        byKey.set(visitKey({ ...entry, kind: "file", at: 0 }), entry);
      }
    }
    return byKey;
  }, [layoutByWorkspace]);

  // One pass over the project tree gives both halves of a row's identity: the
  // workspace name under the title, and which project's icon belongs beside it.
  const { workspaceTitleByKey, projectByWorkspaceKey } = useMemo(() => {
    const titles = new Map<string, string>();
    const projectByWorkspace = new Map<string, { viewKey: string; initial: string }>();
    for (const project of projects) {
      const identity = {
        viewKey: project.viewKey,
        initial: projectIconPlaceholderLabelFromDisplayName(project.projectName),
      };
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          const key = `${host.serverId}:${workspace.id}`;
          titles.set(key, workspace.title ?? workspace.name);
          projectByWorkspace.set(key, identity);
        }
      }
    }
    return { workspaceTitleByKey: titles, projectByWorkspaceKey: projectByWorkspace };
  }, [projects]);

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

  const candidates = useMemo<TabSwitcherCandidate[]>(() => {
    const live = agents.filter((agent) => !agent.archivedAt);
    const agentKey = (serverId: string, agentId: string) =>
      visitKey({ kind: "agent", serverId, agentId, at: 0 });
    const agentByKey = new Map(live.map((agent) => [agentKey(agent.serverId, agent.id), agent]));
    const visitedAtByKey = new Map(history.map((entry) => [visitKey(entry), entry.at]));

    // Visited tabs keep their true visit order; everything else follows so the list
    // is never one row long — chats by their own last activity, then files by when
    // they were opened.
    const fallbackKeys = [
      ...live
        .slice()
        .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
        .map((agent) => agentKey(agent.serverId, agent.id)),
      ...[...openFileTabs.entries()]
        .sort(([, left], [, right]) => right.createdAt - left.createdAt)
        .map(([key]) => key),
    ];
    const orderedKeys = mergeRecentOrder(
      history
        .map((entry) => visitKey(entry))
        .filter((key) => agentByKey.has(key) || openFileTabs.has(key)),
      fallbackKeys,
      TAB_SWITCHER_VISIBLE_LIMIT,
    );

    const describeProject = (workspaceKey: string | null) => {
      const workspaceTitle = workspaceKey ? workspaceTitleByKey.get(workspaceKey) : undefined;
      const project = workspaceKey ? projectByWorkspaceKey.get(workspaceKey) : undefined;
      return {
        workspaceTitle,
        iconDataUri: project ? (iconDataByProjectViewKey.get(project.viewKey) ?? null) : null,
        projectInitial: project?.initial ?? "",
        projectViewKey: project?.viewKey ?? "",
      };
    };

    const rows: TabSwitcherCandidate[] = [];
    for (const key of orderedKeys) {
      const agent = agentByKey.get(key);
      if (agent) {
        const workspaceKey = agent.workspaceId ? `${agent.serverId}:${agent.workspaceId}` : null;
        const project = describeProject(workspaceKey);
        rows.push({
          kind: "agent",
          serverId: agent.serverId,
          agentId: agent.id,
          at: visitedAtByKey.get(key) ?? agent.lastActivityAt.getTime(),
          title: agent.title || t("shell.commandCenter.newAgent"),
          subtitle: project.workspaceTitle ?? shortenPath(agent.cwd),
          status: agent.status ?? null,
          requiresAttention: Boolean(agent.requiresAttention),
          iconDataUri: project.iconDataUri,
          projectInitial: project.projectInitial,
          projectViewKey: project.projectViewKey || agent.serverId,
        });
        continue;
      }
      const file = openFileTabs.get(key);
      if (!file) {
        continue;
      }
      const project = describeProject(`${file.serverId}:${file.workspaceId}`);
      rows.push({
        kind: "file",
        serverId: file.serverId,
        workspaceId: file.workspaceId,
        path: file.path,
        at: visitedAtByKey.get(key) ?? file.createdAt,
        title: fileNameFromPath(file.path),
        subtitle: project.workspaceTitle ?? shortenPath(file.path),
        status: null,
        requiresAttention: false,
        iconDataUri: project.iconDataUri,
        projectInitial: project.projectInitial,
        projectViewKey: project.projectViewKey || file.serverId,
      });
    }
    return rows;
  }, [
    agents,
    history,
    iconDataByProjectViewKey,
    openFileTabs,
    projectByWorkspaceKey,
    t,
    workspaceTitleByKey,
  ]);

  useEffect(() => {
    setCandidates(candidates);
  }, [candidates, setCandidates]);
}

function TabSwitcherOverlay() {
  const { t } = useTranslation();
  const open = useTabSwitcherStore((state) => state.open);
  const visible = useTabSwitcherStore((state) => state.visible);
  const candidates = useTabSwitcherStore((state) => state.candidates);
  const selectedIndex = useTabSwitcherStore((state) => state.selectedIndex);
  useOverlayKeys(open);

  if (!open || !visible || candidates.length === 0) {
    return null;
  }

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.panel}>
        <Text style={styles.heading} numberOfLines={1}>
          {t("workspace.tabSwitcher.title")}
        </Text>
        {candidates.map((candidate, index) => (
          <TabSwitcherRow
            key={visitKey(candidate)}
            candidate={candidate}
            index={index}
            selected={index === selectedIndex}
          />
        ))}
      </View>
    </View>
  );
}

function TabSwitcherRow({
  candidate,
  index,
  selected,
}: {
  candidate: TabSwitcherCandidate;
  index: number;
  selected: boolean;
}) {
  const onHoverIn = useCallback(() => {
    // The overlay opens under wherever the cursor is already resting, which fires
    // a hover for that row and steals the selection from the keyboard. Ignore it
    // until the mouse has actually moved — see noteTabSwitcherPointerMoved.
    if (isTabSwitcherPointerSelectionAllowed()) {
      selectTabSwitcherIndex(index);
    }
  }, [index]);
  const onPress = useCallback(() => {
    // A click is unambiguous intent, so it never waits for the movement gate.
    selectTabSwitcherIndex(index);
    commitTabSwitcher();
  }, [index]);
  const rowStyle = useMemo(() => [styles.row, selected && styles.rowSelected], [selected]);
  return (
    <Pressable style={rowStyle} onHoverIn={onHoverIn} onPress={onPress}>
      {/* The icon leads the row: a column of marks is scannable before a word of
          it is read, which is the whole point of the switcher. A file gets its
          filetype icon rather than its project's, so the two kinds of tab are
          told apart at a glance — the workspace name is still on the line below. */}
      {candidate.kind === "file" ? (
        <View style={styles.rowFileIcon}>
          <MaterialFileIcon fileName={candidate.title} size={TAB_SWITCHER_ICON_SIZE} />
        </View>
      ) : (
        <ProjectIconView
          iconDataUri={candidate.iconDataUri}
          initial={candidate.projectInitial}
          projectViewKey={candidate.projectViewKey}
          size={TAB_SWITCHER_ICON_SIZE}
          textStyle={styles.rowIconFallbackText}
        />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {candidate.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {candidate.subtitle}
        </Text>
      </View>
      <AgentStatusDot
        status={candidate.status}
        requiresAttention={candidate.requiresAttention}
        showInactive
      />
    </Pressable>
  );
}

/**
 * While the switcher is open the whole keyboard is ours.
 *
 * Two jobs. Escape / Enter / arrows drive the list directly — deliberately NOT
 * registered as app shortcuts, since they only mean anything for the moment the
 * overlay is up. And every event, whatever it is, is handed to the controller so
 * it can tell "still holding Hyper" from "let go", which is what commits.
 */
function useOverlayKeys(open: boolean): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!isWeb || !open || typeof document === "undefined") {
      return;
    }
    const modifiersHeld = (event: KeyboardEvent) =>
      event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;

    const onKeyUp = (event: KeyboardEvent) => {
      if (!openRef.current) {
        return;
      }
      handleTabSwitcherKeyEvent({
        type: "keyup",
        key: event.key,
        modifiersHeld: modifiersHeld(event),
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!openRef.current) {
        return;
      }
      handleTabSwitcherKeyEvent({
        type: "keydown",
        key: event.key,
        modifiersHeld: modifiersHeld(event),
      });
      if (event.key === "Escape") {
        event.preventDefault();
        cancelTabSwitcher();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitTabSwitcher();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        cycleTabSwitcher(1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        cycleTabSwitcher(-1);
      }
    };

    // A window that loses focus can never deliver the keyup we commit on.
    const onBlur = () => cancelTabSwitcher();

    // Sub-pixel jitter and trackpad noise are not a decision to select a row, so
    // the pointer only earns its vote after moving a real distance.
    let origin: { x: number; y: number } | null = null;
    const onMouseMove = (event: MouseEvent) => {
      if (!origin) {
        origin = { x: event.clientX, y: event.clientY };
        return;
      }
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) >= POINTER_INTENT_THRESHOLD_PX) {
        noteTabSwitcherPointerMoved();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    // Paseo is often run squeezed into a quarter of the screen (Hyper+; layout
    // toggle), which on the built-in display is ~378pt. The padding keeps the
    // panel off the window edges at that width instead of bleeding into them.
    padding: theme.spacing[4],
    zIndex: 1000,
  },
  panel: {
    // Fluid, never fixed. A hardcoded minWidth wider than the window clipped the
    // whole panel in squeezed mode — the switcher was unusable exactly where it
    // is needed most, since a narrow window is where tab bars overflow first.
    width: "100%",
    maxWidth: 560,
    maxHeight: "100%",
    overflow: "hidden",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: 2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  heading: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  rowIconFallbackText: {
    fontSize: 11,
  },
  // Matches the project icon's footprint so both kinds of row align on one column.
  rowFileIcon: {
    width: TAB_SWITCHER_ICON_SIZE,
    height: TAB_SWITCHER_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));

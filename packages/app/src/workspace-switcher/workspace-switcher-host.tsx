import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { ProjectIconView } from "@/components/project-icon-view";
import { useDeskStore } from "@/desk/desk-store";
import { orderKeysDeskFirst, toKeySet } from "@/desk/model";
import { isWeb } from "@/constants/platform";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import {
  useSidebarWorkspacesList,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { useProjectIcons } from "@/projects/icons";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  cancelWorkspaceSwitcher,
  commitWorkspaceSwitcher,
  cycleWorkspaceSwitcher,
  handleWorkspaceSwitcherKeyEvent,
  isWorkspaceSwitcherPointerSelectionAllowed,
  noteWorkspaceSwitcherPointerMoved,
  selectWorkspaceSwitcherIndex,
} from "@/workspace-switcher/controller";
import {
  mergeWorkspaceOrder,
  WORKSPACE_SWITCHER_VISIBLE_LIMIT,
  workspaceVisitKey,
} from "@/workspace-switcher/model";
import { useWorkspaceSwitcherMruStore } from "@/workspace-switcher/mru-store";
import {
  useWorkspaceSwitcherStore,
  type WorkspaceSwitcherCandidate,
} from "@/workspace-switcher/workspace-switcher-store";

const WORKSPACE_SWITCHER_ICON_SIZE = 22;
const POINTER_INTENT_THRESHOLD_PX = 6;

interface WorkspaceProjectIdentity {
  viewKey: string;
  initial: string;
}

export function WorkspaceSwitcherHost() {
  useWorkspaceVisitRecorder();
  useWorkspaceCandidateSync();
  return <WorkspaceSwitcherOverlay />;
}

function useWorkspaceVisitRecorder(): void {
  const selection = useActiveWorkspaceSelection();
  const visit = useWorkspaceSwitcherMruStore((state) => state.visit);
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (serverId && workspaceId) visit({ serverId, workspaceId });
  }, [serverId, visit, workspaceId]);
}

function createWorkspaceCandidate(input: {
  workspace: SidebarWorkspacePlacement;
  layout: WorkspaceLayout | null;
  agentByKey: ReadonlyMap<string, AggregatedAgent>;
  visitedAt: number;
  title: string;
  project: WorkspaceProjectIdentity;
  iconDataUri: string | null;
}): WorkspaceSwitcherCandidate {
  const target = input.layout
    ? (deriveWorkspacePaneState({
        layout: input.layout,
        tabs: collectAllTabs(input.layout.root),
      }).activeTab?.descriptor.target ?? null)
    : null;
  const focusedAgent =
    target?.kind === "agent"
      ? (input.agentByKey.get(`${input.workspace.serverId}:${target.agentId}`) ?? null)
      : null;
  return {
    serverId: input.workspace.serverId,
    workspaceId: input.workspace.workspaceId,
    at: input.visitedAt,
    title: input.title,
    status: focusedAgent?.status ?? null,
    requiresAttention: Boolean(focusedAgent?.requiresAttention),
    iconDataUri: input.iconDataUri,
    projectInitial: input.project.initial,
    projectViewKey: input.project.viewKey,
  };
}

function useWorkspaceCandidateSync(): void {
  const selection = useActiveWorkspaceSelection();
  const history = useWorkspaceSwitcherMruStore((state) => state.history);
  const setCandidates = useWorkspaceSwitcherStore((state) => state.setCandidates);
  const pruneHistory = useWorkspaceSwitcherMruStore((state) => state.prune);
  const { workspacePlacements } = useSidebarWorkspacesList({ enabled: true });
  const { projects } = useProjects({ enabled: true });
  const { agents } = useAggregatedAgents({ demand: false });
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);
  const deskKeyList = useDeskStore((state) => state.deskKeys);
  const deskKeys = useMemo(() => toKeySet(deskKeyList), [deskKeyList]);

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

  const activeKey = selection ? workspaceVisitKey(selection) : null;
  const liveKeys = useMemo(
    () => new Set(workspacePlacements.map((workspace) => workspace.workspaceKey)),
    [workspacePlacements],
  );

  const candidates = useMemo<WorkspaceSwitcherCandidate[]>(() => {
    const liveAgents = agents.filter((agent) => !agent.archivedAt);
    const agentByKey = new Map(
      liveAgents.map((agent) => [`${agent.serverId}:${agent.id}`, agent] as const),
    );
    const visitedAtByKey = new Map(history.map((visit) => [workspaceVisitKey(visit), visit.at]));
    const placementByKey = new Map(
      workspacePlacements.map((workspace) => [workspace.workspaceKey, workspace] as const),
    );
    const validHistoryKeys = history
      .map((visit) => workspaceVisitKey(visit))
      .filter((key) => placementByKey.has(key) && key !== activeKey);
    const rowZeroIsCurrent = Boolean(activeKey && placementByKey.has(activeKey));
    // Desk first (fork mod #12), after row 0 and the workspace just left, which stay put so a
    // quick tap still lands on it. The cut to the visible limit comes after the reorder.
    const orderedKeys = orderKeysDeskFirst(
      mergeWorkspaceOrder(
        rowZeroIsCurrent && activeKey ? [activeKey, ...validHistoryKeys] : validHistoryKeys,
        workspacePlacements.map((workspace) => workspace.workspaceKey),
        Number.POSITIVE_INFINITY,
      ),
      deskKeys,
      rowZeroIsCurrent ? 2 : 1,
    ).slice(0, WORKSPACE_SWITCHER_VISIBLE_LIMIT);

    const rows: WorkspaceSwitcherCandidate[] = [];
    for (const key of orderedKeys) {
      const workspace = placementByKey.get(key);
      if (!workspace) {
        continue;
      }
      const project = projectByWorkspaceKey.get(key) ?? {
        viewKey: workspace.projectViewKey,
        initial: projectIconPlaceholderLabelFromDisplayName(workspace.projectName),
      };
      rows.push(
        createWorkspaceCandidate({
          workspace,
          layout: layoutByWorkspace[key] ?? null,
          agentByKey,
          visitedAt: visitedAtByKey.get(key) ?? 0,
          title: workspaceTitleByKey.get(key) ?? workspace.name,
          project,
          iconDataUri: iconDataByProjectViewKey.get(project.viewKey) ?? null,
        }),
      );
    }
    return rows;
  }, [
    activeKey,
    agents,
    deskKeys,
    history,
    iconDataByProjectViewKey,
    layoutByWorkspace,
    projectByWorkspaceKey,
    workspacePlacements,
    workspaceTitleByKey,
  ]);

  useEffect(() => {
    setCandidates(candidates, activeKey, liveKeys);
  }, [activeKey, candidates, liveKeys, setCandidates]);

  // The workspace just opened may not be in the placements yet; never prune it.
  useEffect(() => {
    pruneHistory(liveKeys, activeKey);
  }, [activeKey, liveKeys, pruneHistory]);
}

function WorkspaceSwitcherOverlay() {
  const { t } = useTranslation();
  const open = useWorkspaceSwitcherStore((state) => state.open);
  const visible = useWorkspaceSwitcherStore((state) => state.visible);
  const candidates = useWorkspaceSwitcherStore((state) => state.candidates);
  const selectedIndex = useWorkspaceSwitcherStore((state) => state.selectedIndex);
  useOverlayKeys(open);

  if (!open || !visible || candidates.length === 0) {
    return null;
  }
  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.panel}>
        <Text style={styles.heading} numberOfLines={1}>
          {t("workspace.workspaceSwitcher.title")}
        </Text>
        {candidates.map((candidate, index) => (
          <WorkspaceSwitcherRow
            key={workspaceVisitKey(candidate)}
            candidate={candidate}
            index={index}
            selected={index === selectedIndex}
          />
        ))}
      </View>
    </View>
  );
}

function WorkspaceSwitcherRow({
  candidate,
  index,
  selected,
}: {
  candidate: WorkspaceSwitcherCandidate;
  index: number;
  selected: boolean;
}) {
  const onHoverIn = useCallback(() => {
    if (isWorkspaceSwitcherPointerSelectionAllowed()) {
      selectWorkspaceSwitcherIndex(index);
    }
  }, [index]);
  const onPress = useCallback(() => {
    selectWorkspaceSwitcherIndex(index);
    commitWorkspaceSwitcher();
  }, [index]);
  const rowStyle = useMemo(() => [styles.row, selected && styles.rowSelected], [selected]);
  return (
    <Pressable style={rowStyle} onHoverIn={onHoverIn} onPress={onPress}>
      <ProjectIconView
        iconDataUri={candidate.iconDataUri}
        initial={candidate.projectInitial}
        projectViewKey={candidate.projectViewKey}
        size={WORKSPACE_SWITCHER_ICON_SIZE}
        textStyle={styles.rowIconFallbackText}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {candidate.title}
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
      handleWorkspaceSwitcherKeyEvent({
        type: "keyup",
        key: event.key,
        modifiersHeld: modifiersHeld(event),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!openRef.current) {
        return;
      }
      handleWorkspaceSwitcherKeyEvent({
        type: "keydown",
        key: event.key,
        modifiersHeld: modifiersHeld(event),
      });
      if (event.key === "Escape") {
        event.preventDefault();
        cancelWorkspaceSwitcher();
      } else if (event.key === "Enter") {
        event.preventDefault();
        commitWorkspaceSwitcher();
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        cycleWorkspaceSwitcher(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        cycleWorkspaceSwitcher(-1);
      }
    };
    const onBlur = () => cancelWorkspaceSwitcher();
    let origin: { x: number; y: number } | null = null;
    const onMouseMove = (event: MouseEvent) => {
      if (!origin) {
        origin = { x: event.clientX, y: event.clientY };
        return;
      }
      if (
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >=
        POINTER_INTENT_THRESHOLD_PX
      ) {
        noteWorkspaceSwitcherPointerMoved();
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
    padding: theme.spacing[4],
    zIndex: 1001,
  },
  panel: {
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
  rowSelected: { backgroundColor: theme.colors.surface3 },
  rowIconFallbackText: { fontSize: 11 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
}));

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AgentStatusDot } from "@/components/agent-status-dot";
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
  selectTabSwitcherIndex,
} from "@/tab-switcher/controller";
import { TAB_SWITCHER_VISIBLE_LIMIT } from "@/tab-switcher/model";
import { useTabSwitcherMruStore } from "@/tab-switcher/mru-store";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { shortenPath } from "@/utils/shorten-path";

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

  const activeAgentId = useMemo(() => {
    if (!layout) {
      return null;
    }
    const paneState = deriveWorkspacePaneState({ layout, tabs: collectAllTabs(layout.root) });
    const target = paneState.activeTab?.descriptor.target ?? null;
    return target?.kind === "agent" ? target.agentId : null;
  }, [layout]);

  const serverId = selection?.serverId ?? null;
  useEffect(() => {
    if (!serverId || !activeAgentId) {
      return;
    }
    visit({ serverId, agentId: activeAgentId });
  }, [activeAgentId, serverId, visit]);
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

  const workspaceTitleByKey = useMemo(() => {
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

  const candidates = useMemo<TabSwitcherCandidate[]>(() => {
    const agentByKey = new Map(agents.map((agent) => [`${agent.serverId}:${agent.id}`, agent]));
    const rows: TabSwitcherCandidate[] = [];
    for (const entry of history) {
      const agent = agentByKey.get(`${entry.serverId}:${entry.agentId}`);
      if (!agent || agent.archivedAt) {
        continue;
      }
      const workspaceTitle = agent.workspaceId
        ? workspaceTitleByKey.get(`${agent.serverId}:${agent.workspaceId}`)
        : undefined;
      rows.push({
        ...entry,
        title: agent.title || t("shell.commandCenter.newAgent"),
        subtitle: workspaceTitle ?? shortenPath(agent.cwd),
        status: agent.status ?? null,
        requiresAttention: Boolean(agent.requiresAttention),
      });
      if (rows.length >= TAB_SWITCHER_VISIBLE_LIMIT) {
        break;
      }
    }
    return rows;
  }, [agents, history, t, workspaceTitleByKey]);

  useEffect(() => {
    setCandidates(candidates);
  }, [candidates, setCandidates]);
}

function TabSwitcherOverlay() {
  const { t } = useTranslation();
  const open = useTabSwitcherStore((state) => state.open);
  const candidates = useTabSwitcherStore((state) => state.candidates);
  const selectedIndex = useTabSwitcherStore((state) => state.selectedIndex);
  useOverlayKeys(open);

  if (!open || candidates.length === 0) {
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
            key={`${candidate.serverId}:${candidate.agentId}`}
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
  const onHoverIn = useCallback(() => selectTabSwitcherIndex(index), [index]);
  const onPress = useCallback(() => {
    selectTabSwitcherIndex(index);
    commitTabSwitcher();
  }, [index]);
  const rowStyle = useMemo(() => [styles.row, selected && styles.rowSelected], [selected]);
  return (
    <Pressable style={rowStyle} onHoverIn={onHoverIn} onPress={onPress}>
      <AgentStatusDot
        status={candidate.status}
        requiresAttention={candidate.requiresAttention}
        showInactive
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {candidate.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {candidate.subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * While the switcher is open, Escape / Enter / arrows drive it directly. These
 * keys are deliberately NOT registered as app shortcuts: they only mean
 * anything for the ~1s the overlay is up, and stealing them globally would
 * break every other surface.
 */
function useOverlayKeys(open: boolean): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!isWeb || !open || typeof document === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!openRef.current) {
        return;
      }
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
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
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
    zIndex: 1000,
  },
  panel: {
    minWidth: 360,
    maxWidth: 560,
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

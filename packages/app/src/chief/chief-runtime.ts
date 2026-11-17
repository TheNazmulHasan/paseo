import type { AppCommand } from "@getpaseo/protocol/chief";
import { useBoardStore } from "@/boards/board-store";
import { navigateToBoard } from "@/boards/navigation";
import type { CommandCenterContribution } from "@/command-center/contributions";
import type { KeyboardShortcutPayload } from "@/keyboard/actions";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { handleAppCommand, type AppCommandResult, type ChiefAppDeps } from "./handle-app-command";

/**
 * Nazmul mod (chief): the real wiring behind `app_command`. Two pieces live in React and are
 * handed over by registration: the keyboard's router (registered by `useKeyboardShortcuts`, so
 * `run_action` goes through exactly what a key press does) and the Command Center's live item list
 * (registered by `ChiefHost`).
 */

type ShortcutRunner = (input: { action: string; payload: KeyboardShortcutPayload }) => boolean;

let shortcutRunner: ShortcutRunner | null = null;
let commandItems: (() => readonly CommandCenterContribution[]) | null = null;

export function registerShortcutRunner(runner: ShortcutRunner): () => void {
  shortcutRunner = runner;
  return () => {
    if (shortcutRunner === runner) shortcutRunner = null;
  };
}

export function registerCommandItems(source: () => readonly CommandCenterContribution[]): () => void {
  commandItems = source;
  return () => {
    if (commandItems === source) commandItems = null;
  };
}

export function createChiefDeps(serverId: string): ChiefAppDeps {
  return {
    serverId,
    hostState(id) {
      const session = useSessionStore.getState().sessions[id];
      if (!session) return null;
      return {
        connected: isHostRuntimeConnected(getHostRuntimeStore().getSnapshot(id)),
        workspacesHydrated: session.hasHydratedWorkspaces,
        workspaces: session.workspaces,
      };
    },
    navigateToWorkspace: (input) => {
      navigateToWorkspace(input);
    },
    revealWorkspaceTab: (key, tabId) => {
      revealWorkspaceTab(key, tabId);
    },
    findTab(workspaceKey, tabId) {
      const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
      if (!layout) return null;
      return collectAllTabs(layout.root).find((tab) => tab.tabId === tabId) ?? null;
    },
    listBoards() {
      const { boards, order } = useBoardStore.getState();
      return order.flatMap((id) => (boards[id] ? [{ id, name: boards[id].name }] : []));
    },
    navigateToBoard,
    runKeyboardAction: (input) => shortcutRunner?.(input) ?? false,
    commandItems: () => commandItems?.() ?? [],
  };
}

export function runChiefCommand(serverId: string, command: AppCommand): Promise<AppCommandResult> {
  return handleAppCommand(command, createChiefDeps(serverId));
}

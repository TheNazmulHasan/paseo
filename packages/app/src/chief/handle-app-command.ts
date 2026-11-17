import type { AppActionInfo, AppCommand } from "@getpaseo/protocol/chief";
import type { CommandCenterContribution } from "@/command-center/contributions";
import type { KeyboardShortcutPayload } from "@/keyboard/actions";
import type { WorkspaceLinkHostState } from "@/workspace-links/resolve";
import { resolveWorkspaceLinkOpen } from "@/workspace-links/resolve";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  listAppActions,
  listKeyboardActions,
  payloadFromArgs,
  resolveActionId,
} from "./app-actions";

/**
 * Nazmul mod (chief): does what an `app_command` asks, in the app. Every effect goes through
 * `ChiefAppDeps`, so the real wiring (stores, the keyboard router, the Command Center registry)
 * lives in `chief-runtime.ts` and this file is tested with those mocked.
 */

export interface ChiefAppDeps {
  /** The server whose daemon sent the command; the default for `args.serverId`. */
  serverId: string;
  hostState(serverId: string): WorkspaceLinkHostState | null;
  navigateToWorkspace(input: {
    serverId: string;
    workspaceId: string;
    target?: WorkspaceTabTarget;
  }): void;
  revealWorkspaceTab(workspaceKey: string, tabId: string): void;
  /** The target of an open tab, or null when the workspace has no such tab. */
  findTab(workspaceKey: string, tabId: string): { target: WorkspaceTabTarget } | null;
  listBoards(): readonly { id: string; name: string }[];
  navigateToBoard(boardId: string): void;
  /** The keyboard's own router and performer; false when nothing handled the action. */
  runKeyboardAction(input: { action: string; payload: KeyboardShortcutPayload }): boolean;
  commandItems(): readonly CommandCenterContribution[];
}

export interface AppCommandResult {
  ok: boolean;
  error: string | null;
  actions?: AppActionInfo[];
}

const OK: AppCommandResult = { ok: true, error: null };

function fail(error: string): AppCommandResult {
  return { ok: false, error };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function openWorkspace(args: Record<string, unknown>, deps: ChiefAppDeps): AppCommandResult {
  const workspaceId = text(args.workspaceId);
  if (!workspaceId) return fail("open_workspace needs args.workspaceId");
  const serverId = text(args.serverId) ?? deps.serverId;
  const tabId = text(args.tabId);
  const agentId = text(args.agentId);

  const outcome = resolveWorkspaceLinkOpen(
    { serverId, workspaceId, view: "workspace" },
    deps.hostState(serverId),
  );
  if (outcome.kind === "host-unavailable") return fail(`Host ${serverId} is not connected in the app`);
  if (outcome.kind === "workspace-missing") return fail(`Workspace not found: ${workspaceId}`);
  if (outcome.kind !== "navigate") return fail("That workspace cannot be opened");

  // The workspace map key can differ from the id the caller used; the layout keys use the key.
  const resolvedId = outcome.workspaceId;
  const workspaceKey = `${serverId}:${resolvedId}`;
  let target: WorkspaceTabTarget | undefined;
  if (tabId) {
    const tab = deps.findTab(workspaceKey, tabId);
    if (!tab) return fail(`Tab not found in ${workspaceId}: ${tabId}`);
    target = tab.target;
  } else if (agentId) {
    target = { kind: "agent", agentId };
  }
  // Same two steps as a sidebar tab line: open the workspace on that target, then reveal the tab.
  deps.navigateToWorkspace({ serverId, workspaceId: resolvedId, ...(target ? { target } : {}) });
  if (tabId) deps.revealWorkspaceTab(workspaceKey, tabId);
  return OK;
}

function openView(args: Record<string, unknown>, deps: ChiefAppDeps): AppCommandResult {
  const viewId = text(args.viewId);
  const name = text(args.name);
  if (!viewId && !name) return fail("open_view needs args.viewId or args.name");
  const boards = deps.listBoards();
  const board = viewId
    ? boards.find((candidate) => candidate.id === viewId)
    : boards.find((candidate) => candidate.name.toLowerCase() === name!.toLowerCase());
  if (!board) {
    return fail(
      `View not found: ${viewId ?? name}. Views: ${boards.map((b) => b.name).join(", ") || "(none)"}`,
    );
  }
  deps.navigateToBoard(board.id);
  return OK;
}

async function runAction(args: Record<string, unknown>, deps: ChiefAppDeps): Promise<AppCommandResult> {
  const actionId = text(args.actionId);
  if (!actionId) return fail("run_action needs args.actionId");
  const items = deps.commandItems();
  const resolved = resolveActionId(actionId, items);
  if (resolved.kind === "unknown") {
    return fail(`Unknown action id: ${actionId}. Call list_app_actions for the ids that exist.`);
  }

  if (resolved.kind === "command") {
    try {
      await resolved.item.run();
      return OK;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  const inner =
    args.args && typeof args.args === "object" ? (args.args as Record<string, unknown>) : undefined;
  const payload = payloadFromArgs(inner);
  if (payload && typeof payload === "object" && "error" in payload) return fail(payload.error);
  const needs = listKeyboardActions().find((info) => info.id === `keyboard:${resolved.action}`)?.args;
  if (needs && payload === null) {
    return fail(`${resolved.action} needs args (${needs})`);
  }
  const handled = deps.runKeyboardAction({ action: resolved.action, payload });
  return handled
    ? OK
    : fail(
        `${resolved.action} did nothing here: no screen is listening for it right now (for example a tab action with no workspace open).`,
      );
}

export async function handleAppCommand(
  command: AppCommand,
  deps: ChiefAppDeps,
): Promise<AppCommandResult> {
  try {
    switch (command.action) {
      case "open_workspace":
        return openWorkspace(command.args, deps);
      case "open_view":
        return openView(command.args, deps);
      case "run_action":
        return await runAction(command.args, deps);
      case "list_actions":
        return { ok: true, error: null, actions: listAppActions(deps.commandItems()) };
      default:
        return fail(`Unknown app command: ${String((command as { action: unknown }).action)}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

import { describe, expect, it, vi } from "vitest";

import type { AppCommand } from "@getpaseo/protocol/chief";
import type { CommandCenterContribution } from "@/command-center/contributions";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { routeKeyboardShortcut, type ShortcutAction } from "@/keyboard/route-shortcut";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { handleAppCommand, type ChiefAppDeps } from "./handle-app-command";

const SERVER = "srv_1";

function command(action: AppCommand["action"], args: Record<string, unknown> = {}): AppCommand {
  return { id: "cmd_1", action, args };
}

function item(id: string, title: string, run = vi.fn()): CommandCenterContribution {
  return {
    id,
    group: "actions",
    groupRank: 0,
    rank: 0,
    keywords: [],
    visibility: "always",
    run,
    presentation: { kind: "action", title },
  };
}

/** A fake of everything the handler touches. `dispatch` stands in for the keyboard dispatcher. */
function makeDeps(over: Partial<ChiefAppDeps> = {}) {
  const dispatch = vi.fn<(action: KeyboardActionDefinition) => boolean>(() => true);
  const navigateToWorkspace = vi.fn();
  const revealWorkspaceTab = vi.fn();
  const navigateToBoard = vi.fn();
  const workspaces = new Map<string, WorkspaceDescriptor>([["wks_a", {} as WorkspaceDescriptor]]);
  const deps: ChiefAppDeps = {
    serverId: SERVER,
    hostState: (id) =>
      id === SERVER ? { connected: true, workspacesHydrated: true, workspaces } : null,
    navigateToWorkspace,
    revealWorkspaceTab,
    findTab: (_key, tabId) =>
      tabId === "agent_x" ? { target: { kind: "agent", agentId: "x" } } : null,
    listBoards: () => [
      { id: "b1", name: "Morning" },
      { id: "b2", name: "Faith" },
    ],
    navigateToBoard,
    // The keyboard's own router, with only the final dispatcher mocked.
    runKeyboardAction: ({ action, payload }) => {
      const routed: ShortcutAction = routeKeyboardShortcut(
        { action, payload },
        {
          pathname: "/h/srv_1/workspace/wks_a",
          isMobile: false,
          sidebarShortcutTargets: [],
          navigationActiveWorkspace: null,
          commandCenterOpen: false,
          shortcutsDialogOpen: false,
        },
      );
      return routed.kind === "dispatch" ? dispatch(routed.action) : false;
    },
    commandItems: () => [],
    ...over,
  };
  return { deps, dispatch, navigateToWorkspace, revealWorkspaceTab, navigateToBoard };
}

describe("open_workspace", () => {
  it("navigates like a sidebar click, with no tab", async () => {
    const { deps, navigateToWorkspace, revealWorkspaceTab } = makeDeps();
    const result = await handleAppCommand(command("open_workspace", { workspaceId: "wks_a" }), deps);
    expect(result).toEqual({ ok: true, error: null });
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: SERVER, workspaceId: "wks_a" });
    expect(revealWorkspaceTab).not.toHaveBeenCalled();
  });

  it("with a tabId, opens that tab's target then reveals the tab", async () => {
    const { deps, navigateToWorkspace, revealWorkspaceTab } = makeDeps();
    const result = await handleAppCommand(
      command("open_workspace", { workspaceId: "wks_a", tabId: "agent_x" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(navigateToWorkspace).toHaveBeenCalledWith({
      serverId: SERVER,
      workspaceId: "wks_a",
      target: { kind: "agent", agentId: "x" },
    });
    expect(revealWorkspaceTab).toHaveBeenCalledWith(`${SERVER}:wks_a`, "agent_x");
  });

  it("with an agentId, opens that agent's tab", async () => {
    const { deps, navigateToWorkspace } = makeDeps();
    await handleAppCommand(command("open_workspace", { workspaceId: "wks_a", agentId: "ag1" }), deps);
    expect(navigateToWorkspace).toHaveBeenCalledWith({
      serverId: SERVER,
      workspaceId: "wks_a",
      target: { kind: "agent", agentId: "ag1" },
    });
  });

  it("explains itself when the workspace, tab, host or id is wrong", async () => {
    const { deps, navigateToWorkspace } = makeDeps();
    expect((await handleAppCommand(command("open_workspace", {}), deps)).error).toContain("workspaceId");
    expect(
      (await handleAppCommand(command("open_workspace", { workspaceId: "wks_nope" }), deps)).error,
    ).toBe("Workspace not found: wks_nope");
    expect(
      (await handleAppCommand(command("open_workspace", { workspaceId: "wks_a", tabId: "zzz" }), deps)).error,
    ).toContain("Tab not found");
    expect(
      (await handleAppCommand(command("open_workspace", { workspaceId: "wks_a", serverId: "other" }), deps)).error,
    ).toContain("not connected");
    expect(navigateToWorkspace).not.toHaveBeenCalled();
  });
});

describe("open_view", () => {
  it("opens a view by id or by name (any case)", async () => {
    const { deps, navigateToBoard } = makeDeps();
    expect((await handleAppCommand(command("open_view", { viewId: "b1" }), deps)).ok).toBe(true);
    expect((await handleAppCommand(command("open_view", { name: "faith" }), deps)).ok).toBe(true);
    expect(navigateToBoard.mock.calls).toEqual([["b1"], ["b2"]]);
  });

  it("names the views that exist when it cannot find one", async () => {
    const { deps, navigateToBoard } = makeDeps();
    const result = await handleAppCommand(command("open_view", { name: "Nope" }), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("View not found: Nope. Views: Morning, Faith");
    expect(navigateToBoard).not.toHaveBeenCalled();
  });
});

describe("run_action", () => {
  it("runs a keyboard action through the keyboard router into the dispatcher", async () => {
    const { deps, dispatch } = makeDeps();
    const result = await handleAppCommand(
      command("run_action", { actionId: "keyboard:workspace.pin" }),
      deps,
    );
    expect(result).toEqual({ ok: true, error: null });
    expect(dispatch).toHaveBeenCalledWith({ id: "workspace.pin", scope: "sidebar" });
  });

  it("accepts a bare keyboard id, and passes args as the payload", async () => {
    const { deps, dispatch } = makeDeps();
    await handleAppCommand(command("run_action", { actionId: "workspace.pane.split.right" }), deps);
    expect(dispatch).toHaveBeenCalledWith({ id: "workspace.pane.split.right", scope: "workspace" });
    await handleAppCommand(
      command("run_action", { actionId: "keyboard:workspace.tab.navigate.index", args: { index: 3 } }),
      deps,
    );
    expect(dispatch).toHaveBeenLastCalledWith({
      id: "workspace.tab.navigate-index",
      scope: "workspace",
      index: 3,
    });
  });

  it("rejects an action that needs args when none are given, and bad args", async () => {
    const { deps, dispatch } = makeDeps();
    const missing = await handleAppCommand(
      command("run_action", { actionId: "keyboard:workspace.tab.navigate.index" }),
      deps,
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("needs args");
    const bad = await handleAppCommand(
      command("run_action", { actionId: "keyboard:workspace.tab.navigate.index", args: { index: 99 } }),
      deps,
    );
    expect(bad.error).toContain("1 to 9");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects an unknown id with a message that points to list_app_actions", async () => {
    const { deps, dispatch } = makeDeps();
    const result = await handleAppCommand(command("run_action", { actionId: "keyboard:nope.nothing" }), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Unknown action id: keyboard:nope.nothing. Call list_app_actions for the ids that exist.",
    );
    expect((await handleAppCommand(command("run_action", {}), deps)).error).toContain("actionId");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports when nothing handled the action", async () => {
    const { deps, dispatch } = makeDeps();
    dispatch.mockReturnValue(false);
    const result = await handleAppCommand(command("run_action", { actionId: "keyboard:workspace.pin" }), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did nothing here");
  });

  it("runs a Command Center item by id, with or without the command: prefix", async () => {
    const run = vi.fn();
    const { deps } = makeDeps({ commandItems: () => [item("root:add-project", "Add project", run)] });
    expect((await handleAppCommand(command("run_action", { actionId: "command:root:add-project" }), deps)).ok).toBe(true);
    expect((await handleAppCommand(command("run_action", { actionId: "root:add-project" }), deps)).ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns a Command Center item's error to the agent", async () => {
    const { deps } = makeDeps({
      commandItems: () => [
        item(
          "root:boom",
          "Boom",
          vi.fn(() => {
            throw new Error("kaboom");
          }),
        ),
      ],
    });
    const result = await handleAppCommand(command("run_action", { actionId: "command:root:boom" }), deps);
    expect(result).toEqual({ ok: false, error: "kaboom" });
  });
});

describe("list_actions", () => {
  it("lists keyboard actions with help labels and the live Command Center items", async () => {
    const { deps } = makeDeps({
      commandItems: () => [
        item("root:add-project", "Add project"),
        {
          ...item("model:pick", "x"),
          presentation: { kind: "choice", path: ["Model", "Opus"], selected: false },
        },
      ],
    });
    const result = await handleAppCommand(command("list_actions"), deps);
    expect(result.ok).toBe(true);
    const actions = result.actions ?? [];
    const pin = actions.find((a) => a.id === "keyboard:workspace.pin");
    expect(pin).toMatchObject({ kind: "keyboard" });
    expect(pin!.label.length).toBeGreaterThan(0);
    expect(actions.find((a) => a.id === "keyboard:workspace.tab.navigate.index")?.args).toContain("index");
    expect(actions.find((a) => a.id === "command:root:add-project")).toEqual({
      id: "command:root:add-project",
      kind: "command",
      label: "Add project",
    });
    expect(actions.find((a) => a.id === "command:model:pick")?.label).toBe("Model › Opus");
    // every listed keyboard id resolves back
    for (const action of actions.filter((a) => a.kind === "keyboard")) {
      const unknown = await handleAppCommand(command("run_action", { actionId: action.id, args: { index: 1, delta: 1 } }), deps);
      expect(unknown.error ?? "").not.toContain("Unknown action id");
    }
  });
});

describe("failures", () => {
  it("never throws: a crash inside a dep becomes an error result", async () => {
    const { deps } = makeDeps({
      navigateToWorkspace: () => {
        throw new Error("router exploded");
      },
    });
    const result = await handleAppCommand(command("open_workspace", { workspaceId: "wks_a" }), deps);
    expect(result).toEqual({ ok: false, error: "router exploded" });
  });
});

import { describe, expect, it } from "vitest";
import { resolveWorkspaceCommandCenterShortcuts } from "./workspace-shortcuts";

describe("resolveWorkspaceCommandCenterShortcuts", () => {
  it("assigns the New agent command its own shortcut", () => {
    expect(
      resolveWorkspaceCommandCenterShortcuts({
        overrides: {},
        platform: { isMac: true, isDesktop: true },
      }).newAgent,
    ).toEqual([["mod", "shift", "A"]]);
  });

  it("resolves the Desk toggle shortcut, honouring a rebind", () => {
    const platform = { isMac: true, isDesktop: true };
    expect(resolveWorkspaceCommandCenterShortcuts({ overrides: {}, platform }).toggleDesk).toEqual([
      ["mod", "ctrl", "K"],
    ]);
    expect(
      resolveWorkspaceCommandCenterShortcuts({
        overrides: { "workspace-desk-toggle-ctrl-cmd-k-mac": "Cmd+Ctrl+Y" },
        platform,
      }).toggleDesk,
    ).toEqual([["mod", "ctrl", "Y"]]);
  });

  it("resolves the arrange shortcuts, honouring a rebind", () => {
    const platform = { isMac: true, isDesktop: true };
    expect(resolveWorkspaceCommandCenterShortcuts({ overrides: {}, platform }).arrangeGrid).toEqual(
      [["mod", "ctrl", "G"]],
    );
    expect(
      resolveWorkspaceCommandCenterShortcuts({
        overrides: { "workspace-arrange-grid-ctrl-cmd-g-mac": "Cmd+Ctrl+Y" },
        platform,
      }).arrangeGrid,
    ).toEqual([["mod", "ctrl", "Y"]]);
  });
});

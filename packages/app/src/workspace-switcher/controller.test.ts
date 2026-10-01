import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { navigateToWorkspace } = vi.hoisted(() => ({ navigateToWorkspace: vi.fn() }));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: (input: unknown) => navigateToWorkspace(input),
}));

import {
  cycleWorkspaceSwitcher,
  handleWorkspaceSwitcherKeyEvent,
  isWorkspaceSwitcherPointerSelectionAllowed,
  noteWorkspaceSwitcherPointerMoved,
  resetWorkspaceSwitcherReleaseLearningForTests,
} from "@/workspace-switcher/controller";
import { WORKSPACE_SWITCHER_MODIFIER_GRACE_MS } from "@/workspace-switcher/model";
import { useWorkspaceSwitcherStore } from "@/workspace-switcher/workspace-switcher-store";
import { useTabSwitcherStore } from "@/tab-switcher/tab-switcher-store";

function candidate(workspaceId: string) {
  return {
    serverId: "srv",
    workspaceId,
    at: 1,
    title: workspaceId,
    status: null,
    requiresAttention: false,
    iconDataUri: null,
    projectInitial: workspaceId.slice(0, 1),
    projectViewKey: "project",
  };
}

function openSwitcher() {
  useWorkspaceSwitcherStore.setState({
    open: false,
    visible: false,
    selectedIndex: 0,
    candidates: [candidate("a"), candidate("b"), candidate("c")],
  });
  cycleWorkspaceSwitcher(1);
}

describe("workspace switcher controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateToWorkspace.mockClear();
    resetWorkspaceSwitcherReleaseLearningForTests();
    useTabSwitcherStore.setState({ open: false, visible: false, selectedIndex: 0 });
  });

  afterEach(() => vi.useRealTimers());

  it("switches to the previous workspace on release", () => {
    openSwitcher();
    handleWorkspaceSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "b" });
  });

  it("keeps walking while held", () => {
    openSwitcher();
    handleWorkspaceSwitcherKeyEvent({ type: "keydown", key: "Meta", modifiersHeld: true });
    cycleWorkspaceSwitcher(1);
    expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(2);
    expect(navigateToWorkspace).not.toHaveBeenCalled();
  });

  it("commits a plain tap after the Karabiner grace period", () => {
    openSwitcher();
    handleWorkspaceSwitcherKeyEvent({ type: "keyup", key: "Y", modifiersHeld: false });
    vi.advanceTimersByTime(WORKSPACE_SWITCHER_MODIFIER_GRACE_MS);
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "b" });
  });

  it("closes the tab switcher before opening", () => {
    useTabSwitcherStore.setState({ open: true, visible: true, selectedIndex: 1 });
    openSwitcher();
    expect(useTabSwitcherStore.getState().open).toBe(false);
    expect(useWorkspaceSwitcherStore.getState().open).toBe(true);
  });

  it("requires real pointer movement before hover may select", () => {
    openSwitcher();
    expect(isWorkspaceSwitcherPointerSelectionAllowed()).toBe(false);
    noteWorkspaceSwitcherPointerMoved();
    expect(isWorkspaceSwitcherPointerSelectionAllowed()).toBe(true);
    cycleWorkspaceSwitcher(1);
    expect(isWorkspaceSwitcherPointerSelectionAllowed()).toBe(false);
  });
});

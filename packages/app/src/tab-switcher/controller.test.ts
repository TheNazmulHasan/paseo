import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateToAgent, navigateToWorkspace } = vi.hoisted(() => ({
  navigateToAgent: vi.fn(),
  navigateToWorkspace: vi.fn(),
}));
vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: (input: unknown) => navigateToAgent(input),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: (input: unknown) => navigateToWorkspace(input),
}));

import {
  cycleTabSwitcher,
  handleTabSwitcherKeyEvent,
  isTabSwitcherPointerSelectionAllowed,
  noteTabSwitcherPointerMoved,
  resetTabSwitcherReleaseLearningForTests,
} from "@/tab-switcher/controller";
import { TAB_SWITCHER_MODIFIER_GRACE_MS } from "@/tab-switcher/model";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";

function candidate(agentId: string): TabSwitcherCandidate {
  return {
    kind: "agent",
    serverId: "srv",
    agentId,
    at: 1,
    title: agentId,
    subtitle: "",
    status: null,
    requiresAttention: false,
    iconDataUri: null,
    projectInitial: agentId.slice(0, 1),
    projectViewKey: "project",
  };
}

function openSwitcher() {
  useTabSwitcherStore.setState({
    open: false,
    visible: false,
    selectedIndex: 0,
    candidates: [candidate("a"), candidate("b"), candidate("c")],
  });
  cycleTabSwitcher(1);
}

describe("tab switcher hold-vs-tap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateToAgent.mockClear();
    resetTabSwitcherReleaseLearningForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays open while the modifier is held, however long", () => {
    openSwitcher();
    // Trigger key up, Hyper's modifiers not yet restored — ambiguous.
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Tab", modifiersHeld: false });
    // Karabiner restores them a beat later: he is holding.
    vi.advanceTimersByTime(TAB_SWITCHER_MODIFIER_GRACE_MS - 50);
    handleTabSwitcherKeyEvent({ type: "keydown", key: "Meta", modifiersHeld: true });

    vi.advanceTimersByTime(5000);
    expect(useTabSwitcherStore.getState().open).toBe(true);
    expect(navigateToAgent).not.toHaveBeenCalled();
  });

  it("commits the moment the modifier is released", () => {
    openSwitcher();
    handleTabSwitcherKeyEvent({ type: "keydown", key: "Meta", modifiersHeld: true });
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });

    expect(useTabSwitcherStore.getState().open).toBe(false);
    expect(navigateToAgent).toHaveBeenCalledWith({ serverId: "srv", agentId: "b" });
  });

  it("walks the list on repeated presses while held", () => {
    openSwitcher();
    handleTabSwitcherKeyEvent({ type: "keydown", key: "Meta", modifiersHeld: true });
    cycleTabSwitcher(1);
    cycleTabSwitcher(1);
    expect(useTabSwitcherStore.getState().selectedIndex).toBe(0);
    cycleTabSwitcher(1);
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });
    expect(navigateToAgent).toHaveBeenCalledWith({ serverId: "srv", agentId: "b" });
  });

  it("commits quickly on a plain tap, when no modifier ever shows up", () => {
    // The degraded path: if Hyper is invisible to the app, a tap must still feel
    // instant rather than waiting out the safety timer.
    openSwitcher();
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Tab", modifiersHeld: false });
    expect(useTabSwitcherStore.getState().open).toBe(true);

    vi.advanceTimersByTime(TAB_SWITCHER_MODIFIER_GRACE_MS);
    expect(useTabSwitcherStore.getState().open).toBe(false);
    expect(navigateToAgent).toHaveBeenCalledWith({ serverId: "srv", agentId: "b" });
  });

  it("does not paint the overlay for a tap-and-release switch", () => {
    openSwitcher();
    expect(useTabSwitcherStore.getState().visible).toBe(false);
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });
    expect(useTabSwitcherStore.getState().visible).toBe(false);
  });
});

describe("a resting mouse must not steal the selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateToAgent.mockClear();
    resetTabSwitcherReleaseLearningForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the pointer no vote until it actually moves", () => {
    // The overlay paints under wherever the cursor is already parked, and the web
    // layer fires a hover for that row. Landing on it would send you to a chat you
    // never chose — the bug Nazmul hit on 2026-09-18.
    openSwitcher();
    expect(isTabSwitcherPointerSelectionAllowed()).toBe(false);

    noteTabSwitcherPointerMoved();
    expect(isTabSwitcherPointerSelectionAllowed()).toBe(true);
  });

  it("takes the vote back on the next keypress", () => {
    // Mouse parked over a row, then he keeps tapping L: the keyboard must win
    // again without him having to move the mouse away first.
    openSwitcher();
    noteTabSwitcherPointerMoved();
    expect(isTabSwitcherPointerSelectionAllowed()).toBe(true);

    cycleTabSwitcher(1);
    expect(isTabSwitcherPointerSelectionAllowed()).toBe(false);
  });

  it("starts each new switch with the pointer silenced", () => {
    openSwitcher();
    noteTabSwitcherPointerMoved();
    handleTabSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });

    openSwitcher();
    expect(isTabSwitcherPointerSelectionAllowed()).toBe(false);
  });
});

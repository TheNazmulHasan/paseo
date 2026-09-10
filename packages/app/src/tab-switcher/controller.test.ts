import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateToAgent = vi.fn();
vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: (input: unknown) => navigateToAgent(input),
}));

import {
  cycleTabSwitcher,
  handleTabSwitcherKeyEvent,
  resetTabSwitcherReleaseLearningForTests,
} from "@/tab-switcher/controller";
import { TAB_SWITCHER_MODIFIER_GRACE_MS } from "@/tab-switcher/model";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";

function candidate(agentId: string): TabSwitcherCandidate {
  return {
    serverId: "srv",
    agentId,
    at: 1,
    title: agentId,
    subtitle: "",
    status: null,
    requiresAttention: false,
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

import { beforeEach, describe, expect, it } from "vitest";
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

describe("tab switcher store", () => {
  beforeEach(() => {
    useTabSwitcherStore.setState({ open: false, selectedIndex: 0, candidates: [] });
  });

  it("lands on the previous chat with one press", () => {
    // Index 0 is the chat you are already looking at, so a single tap must
    // behave like Alt+Tab and select index 1.
    useTabSwitcherStore.getState().setCandidates([candidate("a"), candidate("b")]);
    expect(useTabSwitcherStore.getState().cycle(1)).toBe(true);
    expect(useTabSwitcherStore.getState().selectedIndex).toBe(1);
  });

  it("walks further back on repeated presses and wraps", () => {
    useTabSwitcherStore.getState().setCandidates([candidate("a"), candidate("b"), candidate("c")]);
    const { cycle } = useTabSwitcherStore.getState();
    cycle(1);
    cycle(1);
    expect(useTabSwitcherStore.getState().selectedIndex).toBe(2);
    cycle(1);
    expect(useTabSwitcherStore.getState().selectedIndex).toBe(0);
  });

  it("does nothing when there is nowhere to switch to", () => {
    useTabSwitcherStore.getState().setCandidates([candidate("a")]);
    expect(useTabSwitcherStore.getState().cycle(1)).toBe(false);
    expect(useTabSwitcherStore.getState().open).toBe(false);
  });

  it("freezes the list while open so it cannot reorder mid-cycle", () => {
    useTabSwitcherStore.getState().setCandidates([candidate("a"), candidate("b")]);
    useTabSwitcherStore.getState().cycle(1);
    useTabSwitcherStore.getState().setCandidates([candidate("z")]);
    expect(useTabSwitcherStore.getState().candidates).toHaveLength(2);
  });
});

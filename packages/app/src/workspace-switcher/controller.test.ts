import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { navigateToWorkspace, navigateToBoard } = vi.hoisted(() => ({
  navigateToWorkspace: vi.fn(),
  navigateToBoard: vi.fn(),
}));

vi.mock("@/boards/navigation", () => ({
  navigateToBoard: (boardId: string) => navigateToBoard(boardId),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: (input: unknown) => navigateToWorkspace(input),
}));

vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));

import {
  commitWorkspaceSwitcher,
  cycleWorkspaceSwitcher,
  handleWorkspaceSwitcherKeyEvent,
  isWorkspaceSwitcherPointerSelectionAllowed,
  noteWorkspaceSwitcherPointerMoved,
  resetWorkspaceSwitcherReleaseLearningForTests,
} from "@/workspace-switcher/controller";
import { WORKSPACE_SWITCHER_MODIFIER_GRACE_MS } from "@/workspace-switcher/model";
import { useWorkspaceSwitcherStore } from "@/workspace-switcher/workspace-switcher-store";
import { cycleTabSwitcher } from "@/tab-switcher/controller";
import { useTabSwitcherStore, type TabSwitcherCandidate } from "@/tab-switcher/tab-switcher-store";

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

function tabCandidate(agentId: string): TabSwitcherCandidate {
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

const ALL_LIVE = new Set(["srv:a", "srv:b", "srv:c"]);

function seedSwitcher(input: {
  ids?: string[];
  currentKey?: string | null;
  liveKeys?: ReadonlySet<string>;
}) {
  useWorkspaceSwitcherStore.setState({
    open: false,
    visible: false,
    selectedIndex: 0,
    candidates: (input.ids ?? ["a", "b", "c"]).map(candidate),
    currentKey: input.currentKey === undefined ? "srv:a" : input.currentKey,
    liveKeys: input.liveKeys ?? ALL_LIVE,
  });
}

function openSwitcher() {
  seedSwitcher({});
  cycleWorkspaceSwitcher(1);
}

describe("workspace switcher controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateToWorkspace.mockClear();
    navigateToBoard.mockClear();
    resetWorkspaceSwitcherReleaseLearningForTests();
    useTabSwitcherStore.setState({ open: false, visible: false, selectedIndex: 0 });
    useWorkspaceSwitcherStore.getState().close();
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

  it("starts on row 0 when not on a workspace, row 1 when on one", () => {
    seedSwitcher({ currentKey: null });
    cycleWorkspaceSwitcher(1);
    expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(0);
    handleWorkspaceSwitcherKeyEvent({ type: "keyup", key: "Meta", modifiersHeld: false });
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "a" });

    navigateToWorkspace.mockClear();
    seedSwitcher({ currentKey: "srv:a" });
    cycleWorkspaceSwitcher(1);
    expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(1);
  });

  it("opens on a single row only when it is not the current workspace", () => {
    seedSwitcher({ ids: ["a"], currentKey: "srv:a" });
    expect(cycleWorkspaceSwitcher(1)).toBe(false);
    seedSwitcher({ ids: ["a"], currentKey: null });
    expect(cycleWorkspaceSwitcher(1)).toBe(true);
    expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(0);
  });

  it("cancels without navigating when the selected workspace was removed", () => {
    openSwitcher();
    useWorkspaceSwitcherStore.setState({ liveKeys: new Set(["srv:a", "srv:c"]) });
    commitWorkspaceSwitcher();
    expect(navigateToWorkspace).not.toHaveBeenCalled();
    expect(useWorkspaceSwitcherStore.getState().open).toBe(false);
  });

  it("drops rows removed while open and clamps the selection", () => {
    openSwitcher();
    cycleWorkspaceSwitcher(1);
    expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(2);
    useWorkspaceSwitcherStore.getState().setCandidates([], "srv:a", new Set(["srv:a", "srv:b"]));
    const state = useWorkspaceSwitcherStore.getState();
    expect(state.candidates.map((row) => row.workspaceId)).toEqual(["a", "b"]);
    expect(state.selectedIndex).toBe(1);
    commitWorkspaceSwitcher();
    expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "b" });
  });

  it("cancels the tab switcher's pending timers when opening", () => {
    useTabSwitcherStore.setState({
      open: false,
      visible: false,
      selectedIndex: 0,
      candidates: [tabCandidate("a"), tabCandidate("b")],
    });
    cycleTabSwitcher(1);
    expect(useTabSwitcherStore.getState().open).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
    openSwitcher();
    expect(useTabSwitcherStore.getState().open).toBe(false);
    // Only the workspace switcher's own reveal + fallback timers remain.
    expect(vi.getTimerCount()).toBe(2);
  });
  describe("board rows (fork mod #13)", () => {
    function seedWithBoard(liveKeys: ReadonlySet<string>) {
      useWorkspaceSwitcherStore.setState({
        open: false,
        visible: false,
        selectedIndex: 0,
        candidates: [
          candidate("a"),
          candidate("b"),
          {
            ...candidate("live"),
            serverId: "board",
            title: "Live",
            boardId: "live",
            boardKind: "live" as const,
            boardSessionCount: 2,
          },
          candidate("c"),
        ],
        currentKey: "srv:a",
        liveKeys,
      });
    }

    it("opens the board, not a workspace, when a board row is committed", () => {
      seedWithBoard(new Set(["srv:a", "srv:b", "srv:c", "board:live"]));
      cycleWorkspaceSwitcher(1);
      cycleWorkspaceSwitcher(1);
      expect(useWorkspaceSwitcherStore.getState().selectedIndex).toBe(2);
      commitWorkspaceSwitcher();
      expect(navigateToBoard).toHaveBeenCalledWith("live");
      expect(navigateToWorkspace).not.toHaveBeenCalled();
    });

    it("still taps through to the previous workspace with boards in the list", () => {
      seedWithBoard(new Set(["srv:a", "srv:b", "srv:c", "board:live"]));
      cycleWorkspaceSwitcher(1);
      commitWorkspaceSwitcher();
      expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "b" });
      expect(navigateToBoard).not.toHaveBeenCalled();
    });

    function boardCandidate(id: string) {
      return {
        ...candidate(id),
        serverId: "board",
        boardId: id,
        boardKind: "user" as const,
        boardSessionCount: 1,
      };
    }

    it("taps from a view back to the workspace you were on before it", () => {
      useWorkspaceSwitcherStore.setState({
        open: false,
        visible: false,
        selectedIndex: 0,
        candidates: [boardCandidate("v1"), candidate("a"), candidate("b")],
        currentKey: "board:v1",
        liveKeys: new Set(["board:v1", "srv:a", "srv:b"]),
      });
      cycleWorkspaceSwitcher(1);
      commitWorkspaceSwitcher();
      expect(navigateToWorkspace).toHaveBeenCalledWith({ serverId: "srv", workspaceId: "a" });
      expect(navigateToBoard).not.toHaveBeenCalled();
    });

    it("taps from a workspace back to the view you were on before it", () => {
      useWorkspaceSwitcherStore.setState({
        open: false,
        visible: false,
        selectedIndex: 0,
        candidates: [candidate("a"), boardCandidate("v1"), candidate("b")],
        currentKey: "srv:a",
        liveKeys: new Set(["board:v1", "srv:a", "srv:b"]),
      });
      cycleWorkspaceSwitcher(1);
      commitWorkspaceSwitcher();
      expect(navigateToBoard).toHaveBeenCalledWith("v1");
      expect(navigateToWorkspace).not.toHaveBeenCalled();
    });

    it("cancels when the board was deleted while the switcher was open", () => {
      seedWithBoard(new Set(["srv:a", "srv:b", "srv:c", "board:live"]));
      cycleWorkspaceSwitcher(1);
      cycleWorkspaceSwitcher(1);
      useWorkspaceSwitcherStore.setState({ liveKeys: new Set(["srv:a", "srv:b", "srv:c"]) });
      commitWorkspaceSwitcher();
      expect(navigateToBoard).not.toHaveBeenCalled();
    });
  });
});

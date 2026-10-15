import { navigateToBoard } from "@/boards/navigation";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { cancelTabSwitcher } from "@/tab-switcher/controller";
import {
  WORKSPACE_SWITCHER_FALLBACK_COMMIT_MS,
  WORKSPACE_SWITCHER_MODIFIER_GRACE_MS,
  WORKSPACE_SWITCHER_REVEAL_DELAY_MS,
  workspaceVisitKey,
} from "@/workspace-switcher/model";
import {
  getSelectedWorkspaceSwitcherCandidate,
  useWorkspaceSwitcherStore,
} from "@/workspace-switcher/workspace-switcher-store";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

let revealTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let releaseCommitProven = false;
let pointerMoved = false;

function clearGraceTimer(): void {
  if (graceTimer !== null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
}

function clearTimers(): void {
  clearGraceTimer();
  if (revealTimer !== null) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

export function cycleWorkspaceSwitcher(delta: number): boolean {
  // Cancel, not just close: the other switcher's pending timers must not fire later.
  cancelTabSwitcher();
  const wasOpen = useWorkspaceSwitcherStore.getState().open;
  const cycled = useWorkspaceSwitcherStore.getState().cycle(delta);
  if (!cycled) {
    return false;
  }
  clearTimers();
  pointerMoved = false;
  if (!wasOpen) {
    revealTimer = setTimeout(() => {
      revealTimer = null;
      useWorkspaceSwitcherStore.getState().reveal();
    }, WORKSPACE_SWITCHER_REVEAL_DELAY_MS);
  }
  if (!releaseCommitProven) {
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      commitWorkspaceSwitcher();
    }, WORKSPACE_SWITCHER_FALLBACK_COMMIT_MS);
  }
  return true;
}

export function handleWorkspaceSwitcherKeyEvent(input: {
  type: "keydown" | "keyup";
  key: string;
  modifiersHeld: boolean;
}): void {
  if (!useWorkspaceSwitcherStore.getState().open) {
    return;
  }
  if (input.modifiersHeld) {
    clearGraceTimer();
    return;
  }
  if (input.type !== "keyup") {
    return;
  }
  if (MODIFIER_KEYS.has(input.key)) {
    releaseCommitProven = true;
    commitWorkspaceSwitcher();
    return;
  }
  clearGraceTimer();
  graceTimer = setTimeout(() => {
    graceTimer = null;
    commitWorkspaceSwitcher();
  }, WORKSPACE_SWITCHER_MODIFIER_GRACE_MS);
}

export function noteWorkspaceSwitcherPointerMoved(): void {
  pointerMoved = true;
}

export function isWorkspaceSwitcherPointerSelectionAllowed(): boolean {
  return pointerMoved;
}

export function selectWorkspaceSwitcherIndex(index: number): void {
  if (!useWorkspaceSwitcherStore.getState().open) {
    return;
  }
  useWorkspaceSwitcherStore.getState().select(index);
  useWorkspaceSwitcherStore.getState().reveal();
}

export function commitWorkspaceSwitcher(): void {
  clearTimers();
  pointerMoved = false;
  const store = useWorkspaceSwitcherStore.getState();
  if (!store.open) {
    return;
  }
  const candidate = getSelectedWorkspaceSwitcherCandidate();
  store.close();
  // The list is frozen while open, so the target may have been archived meanwhile.
  if (!candidate || !store.liveKeys.has(workspaceVisitKey(candidate))) {
    return;
  }
  if (candidate.boardId) {
    navigateToBoard(candidate.boardId);
    return;
  }
  navigateToWorkspace({ serverId: candidate.serverId, workspaceId: candidate.workspaceId });
}

export function cancelWorkspaceSwitcher(): void {
  clearTimers();
  pointerMoved = false;
  useWorkspaceSwitcherStore.getState().close();
}

export function resetWorkspaceSwitcherReleaseLearningForTests(): void {
  releaseCommitProven = false;
  pointerMoved = false;
  clearTimers();
}

import { navigateToAgent } from "@/utils/navigate-to-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  TAB_SWITCHER_FALLBACK_COMMIT_MS,
  TAB_SWITCHER_MODIFIER_GRACE_MS,
  TAB_SWITCHER_REVEAL_DELAY_MS,
} from "@/tab-switcher/model";
import {
  getSelectedTabSwitcherCandidate,
  useTabSwitcherStore,
} from "@/tab-switcher/tab-switcher-store";
import { cancelWorkspaceSwitcher } from "@/workspace-switcher/controller";

// The switcher is release-driven, like every Alt+Tab that has ever felt right:
// the selection lands when the held modifier goes up. Tap and let go and the
// jump is instant; keep Hyper down and the list stays for as long as you like.
//
// Two timers support that, neither of them the mechanism:
//  - reveal: don't paint the overlay for a switch that is over in 100ms.
//  - fallback: if a modifier keyup is ever missed, don't strand the overlay.
let revealTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/**
 * Set once a real modifier release has been seen. From then on the fallback
 * timer is dead weight, and arming it could cut a deliberate long look short —
 * so it retires itself.
 */
let releaseCommitProven = false;

/**
 * Has the mouse actually MOVED since the switcher opened?
 *
 * The overlay paints under wherever the cursor already happens to be resting, and
 * the web layer then fires a hover for whatever row landed beneath it. That hover
 * silently stole the selection from the keyboard: you tap L to walk the list,
 * release, and land on the row the cursor was parked over instead of the one you
 * chose. A stationary cursor is not an intent — until it moves, hover gets no vote.
 *
 * Reset on every keypress too, so the keyboard always wins back control: park the
 * mouse over row 5, press L again, and row 5 cannot re-steal without a real move.
 */
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

/** Open the switcher, or step it by `delta` when already open. */
export function cycleTabSwitcher(delta: number): boolean {
  // Cancel, not just close: the other switcher's pending timers must not fire later.
  cancelWorkspaceSwitcher();
  const wasOpen = useTabSwitcherStore.getState().open;
  const cycled = useTabSwitcherStore.getState().cycle(delta);
  if (!cycled) {
    return false;
  }
  clearTimers();
  pointerMoved = false;
  if (!wasOpen) {
    revealTimer = setTimeout(() => {
      revealTimer = null;
      useTabSwitcherStore.getState().reveal();
    }, TAB_SWITCHER_REVEAL_DELAY_MS);
  }
  if (!releaseCommitProven) {
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      commitTabSwitcher();
    }, TAB_SWITCHER_FALLBACK_COMMIT_MS);
  }
  return true;
}

/**
 * Every key event that reaches the app while the switcher is open, reduced to
 * the only question that matters: is a modifier still down?
 *
 * - modifier still down  → he is holding Hyper. Stay open, however long he likes.
 * - modifier key goes up with nothing left held → he let go. Commit. This is the
 *   real mechanism, and seeing it once retires the fallback timer for good.
 * - some other key goes up with nothing held → ambiguous, because Karabiner
 *   suppresses Hyper's modifiers for the remapped event and restores them a beat
 *   later. Wait out the grace period: a restored modifier cancels it (hold), and
 *   silence means it really was a tap (commit).
 */
export function handleTabSwitcherKeyEvent(input: {
  type: "keydown" | "keyup";
  key: string;
  modifiersHeld: boolean;
}): void {
  if (!useTabSwitcherStore.getState().open) {
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
    commitTabSwitcher();
    return;
  }
  clearGraceTimer();
  graceTimer = setTimeout(() => {
    graceTimer = null;
    commitTabSwitcher();
  }, TAB_SWITCHER_MODIFIER_GRACE_MS);
}

/** A real mouse movement — from here on the pointer may select rows. */
export function noteTabSwitcherPointerMoved(): void {
  pointerMoved = true;
}

/** Whether hovering a row is allowed to move the selection right now. */
export function isTabSwitcherPointerSelectionAllowed(): boolean {
  return pointerMoved;
}

/** Move the selection without committing — arrow keys, and hover once the mouse has moved. */
export function selectTabSwitcherIndex(index: number): void {
  if (!useTabSwitcherStore.getState().open) {
    return;
  }
  useTabSwitcherStore.getState().select(index);
  useTabSwitcherStore.getState().reveal();
}

/** Jump to the selected chat and close. */
export function commitTabSwitcher(): void {
  clearTimers();
  pointerMoved = false;
  const store = useTabSwitcherStore.getState();
  if (!store.open) {
    return;
  }
  const candidate = getSelectedTabSwitcherCandidate();
  store.close();
  if (!candidate) {
    return;
  }
  if (candidate.commit) {
    candidate.commit();
    return;
  }
  if (candidate.kind === "agent") {
    navigateToAgent({ serverId: candidate.serverId, agentId: candidate.agentId });
    return;
  }
  // A file tab lives in one workspace's layout, so reaching it may mean changing
  // workspace first. navigateToWorkspace takes the target and does both.
  navigateToWorkspace({
    serverId: candidate.serverId,
    workspaceId: candidate.workspaceId,
    target: { kind: "file", path: candidate.path },
  });
}

/** Close without going anywhere — Escape. */
export function cancelTabSwitcher(): void {
  clearTimers();
  pointerMoved = false;
  useTabSwitcherStore.getState().close();
}

/** Test seam: forget that a modifier release has ever been observed. */
export function resetTabSwitcherReleaseLearningForTests(): void {
  releaseCommitProven = false;
  pointerMoved = false;
  clearTimers();
}

import { navigateToAgent } from "@/utils/navigate-to-agent";
import { TAB_SWITCHER_COMMIT_DELAY_MS } from "@/tab-switcher/model";
import {
  getSelectedTabSwitcherCandidate,
  useTabSwitcherStore,
} from "@/tab-switcher/tab-switcher-store";

// A tap of the switcher key produces a discrete key event — the modifier is not
// held down between taps once Karabiner remaps it, and xterm/web focus makes a
// keyup-driven commit unreliable anyway. So the switcher commits on idle: each
// tap re-arms this timer, and the selection lands when the taps stop.
let commitTimer: ReturnType<typeof setTimeout> | null = null;

function clearCommitTimer(): void {
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
}

function armCommitTimer(): void {
  clearCommitTimer();
  commitTimer = setTimeout(() => {
    commitTimer = null;
    commitTabSwitcher();
  }, TAB_SWITCHER_COMMIT_DELAY_MS);
}

/** Open the switcher, or step it by `delta` when already open. */
export function cycleTabSwitcher(delta: number): boolean {
  const cycled = useTabSwitcherStore.getState().cycle(delta);
  if (!cycled) {
    return false;
  }
  armCommitTimer();
  return true;
}

/** Move the selection without committing — arrow keys and hover. */
export function selectTabSwitcherIndex(index: number): void {
  if (!useTabSwitcherStore.getState().open) {
    return;
  }
  useTabSwitcherStore.getState().select(index);
  armCommitTimer();
}

/** Jump to the selected chat and close. */
export function commitTabSwitcher(): void {
  clearCommitTimer();
  const store = useTabSwitcherStore.getState();
  if (!store.open) {
    return;
  }
  const candidate = getSelectedTabSwitcherCandidate();
  store.close();
  if (candidate) {
    navigateToAgent({ serverId: candidate.serverId, agentId: candidate.agentId });
  }
}

/** Close without going anywhere — Escape. */
export function cancelTabSwitcher(): void {
  clearCommitTimer();
  useTabSwitcherStore.getState().close();
}

// Home v2 (fork mod, home-map): Close = the existing archive, with Undo for 10 seconds. These
// pieces are pure (the daemon calls are passed in) so batch planning and the undo window are tested.

export const UNDO_WINDOW_MS = 10_000;

export interface CloseTarget {
  serverId: string;
  agentId: string;
}

/** A session the screen can close. */
export interface Closable {
  serverId: string;
  agentId: string;
}

const targetKey = (target: CloseTarget): string => `${target.serverId}:${target.agentId}`;

/** The unique sessions to archive, in the order given. */
export function planClose(sessions: readonly Closable[]): CloseTarget[] {
  const seen = new Set<string>();
  const targets: CloseTarget[] = [];
  for (const session of sessions) {
    const target = { serverId: session.serverId, agentId: session.agentId };
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export interface BatchResult {
  done: CloseTarget[];
  failed: CloseTarget[];
}

/** Runs `action` on every target, one failure never stops the rest. */
export async function runBatch(
  targets: readonly CloseTarget[],
  action: (target: CloseTarget) => Promise<void>,
): Promise<BatchResult> {
  const outcomes = await Promise.allSettled(targets.map((target) => action(target)));
  const done: CloseTarget[] = [];
  const failed: CloseTarget[] = [];
  outcomes.forEach((outcome, index) => {
    (outcome.status === "fulfilled" ? done : failed).push(targets[index]);
  });
  return { done, failed };
}

export interface UndoLedger {
  /** Adds closed targets and returns everything undoable right now (this one and earlier ones). */
  record: (targets: readonly CloseTarget[], now: number) => CloseTarget[];
  /** Everything undoable now, emptied: the Undo press takes it. */
  take: (now: number) => CloseTarget[];
}

/**
 * Remembers what was closed in the last `windowMs`. The toast area shows one toast at a time, so a
 * second close inside the window replaces the first toast; the ledger lets that one Undo bring back
 * both. Each entry lives `windowMs` from when it was closed.
 */
export function createUndoLedger(windowMs: number = UNDO_WINDOW_MS): UndoLedger {
  let entries: { target: CloseTarget; at: number }[] = [];
  const live = (now: number) => entries.filter((entry) => now - entry.at < windowMs);
  return {
    record: (targets, now) => {
      entries = [...live(now), ...targets.map((target) => ({ target, at: now }))];
      return entries.map((entry) => entry.target);
    },
    take: (now) => {
      const taken = live(now).map((entry) => entry.target);
      entries = [];
      return taken;
    },
  };
}

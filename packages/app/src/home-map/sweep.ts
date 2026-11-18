// Home v2 (fork mod, home-map): Sweep goes through the "Check on these" list one session at a time.
// The list is frozen when Sweep starts, so closing or keeping one never reshuffles the rest; a
// session that disappeared meanwhile (closed elsewhere) is skipped.

export interface SweepState {
  /** Session ids (`serverId:agentId`) in the order Check on these had them. */
  ids: readonly string[];
  /** Where we are: the id at this index is the current one (before skipping). */
  index: number;
}

export function startSweep(ids: readonly string[]): SweepState {
  return { ids: [...ids], index: 0 };
}

export interface SweepPosition {
  state: SweepState;
  /** The session to show, or null when the list is finished. */
  currentId: string | null;
  /** 1-based position among all ids ("3 of 39"). */
  position: number;
  total: number;
}

/** Skips ids that are no longer open and reports where Sweep is. */
export function resolveSweep(state: SweepState, present: ReadonlySet<string>): SweepPosition {
  let index = state.index;
  while (index < state.ids.length && !present.has(state.ids[index])) index += 1;
  const total = state.ids.length;
  const next = index === state.index ? state : { ids: state.ids, index };
  return {
    state: next,
    currentId: index < total ? state.ids[index] : null,
    position: Math.min(index + 1, total),
    total,
  };
}

/** Moves past the current session (after Keep or Close). */
export function advanceSweep(state: SweepState): SweepState {
  return { ids: state.ids, index: Math.min(state.index + 1, state.ids.length) };
}

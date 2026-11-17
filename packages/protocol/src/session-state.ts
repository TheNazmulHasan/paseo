/**
 * Nazmul mod (chief): what state is a session in, from the user's seat? One pure function, shared
 * by the server (`session_states` tool) and the app (Home map, `packages/app/src/home-map/`), so
 * both read a session the same way. Lives in protocol because both import it; never copy it.
 *
 * Every signal is one Paseo already keeps. Nothing here guesses from message timestamps: a
 * finished turn almost always ends with the agent replying, so "the agent spoke last" does not
 * mean "the user has not looked yet". `requiresAttention` with reason "finished" does: it is set
 * when a turn completes and cleared when the user opens the session (and `workspace.mark_unread`
 * sets it again on purpose).
 */

export const SESSION_STATES = ["needs_you", "working", "your_move", "parked"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export interface SessionStateInput {
  /** Agent lifecycle status: initializing | idle | running | error | closed. */
  status: string;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  /** How many permission requests are waiting for an answer. */
  pendingPermissionCount?: number;
}

/**
 * - `needs_you`: a permission is pending, attention is for a permission or an error, or the agent
 *   is in the error status. The agent is stuck without the user.
 * - `working`: running or initializing.
 * - `your_move`: a turn finished and the user has not looked at it yet (or it was marked unread).
 * - `parked`: everything else: idle and already seen.
 */
export function deriveSessionState(input: SessionStateInput): SessionState {
  const attention = input.requiresAttention === true ? (input.attentionReason ?? null) : null;
  if (
    (input.pendingPermissionCount ?? 0) > 0 ||
    attention === "permission" ||
    attention === "error" ||
    input.status === "error"
  ) {
    return "needs_you";
  }
  if (input.status === "running" || input.status === "initializing") {
    return "working";
  }
  if (attention === "finished") {
    return "your_move";
  }
  return "parked";
}

/**
 * The one line that says what the user is owed, from the topic trail's "Your move". It is only
 * true while the agent waits, so a working session has none; a blank line is no line.
 */
export function resolveYourMoveText(
  state: SessionState,
  yourMove: string | null | undefined,
): string | null {
  if (state === "working") return null;
  const text = yourMove?.trim();
  return text ? text : null;
}

const STATE_RANK: Record<SessionState, number> = {
  needs_you: 0,
  working: 1,
  your_move: 2,
  parked: 3,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SessionStateFilter {
  state?: readonly SessionState[];
  workspaceId?: string;
  /** A folder id or name (any case). "unfiled" matches sessions whose workspace has no folder. */
  folder?: string;
  /** Only sessions idle for at least this many days. */
  staleDays?: number;
  limit?: number;
  /** Test seam; defaults to the current time. */
  now?: number;
}

interface FilterableRow {
  state: SessionState;
  workspaceId: string | null;
  folderId: string | null;
  folder: string | null;
  lastActivityAt: string | null;
}

function folderMatches(row: FilterableRow, ref: string): boolean {
  const wanted = ref.trim().toLowerCase();
  if (wanted === "unfiled" || wanted === "none") {
    return row.folderId === null;
  }
  return row.folderId?.toLowerCase() === wanted || row.folder?.toLowerCase() === wanted;
}

function activityMs(row: FilterableRow): number {
  if (!row.lastActivityAt) return 0;
  const parsed = Date.parse(row.lastActivityAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Filters, then sorts needs_you, working, your_move, parked; most recent activity first inside each
 * state. Ties break on the input order, so the result is stable.
 */
export function selectSessionStates<T extends FilterableRow>(
  rows: readonly T[],
  filter: SessionStateFilter = {},
): T[] {
  const now = filter.now ?? Date.now();
  const wantedStates = filter.state && filter.state.length > 0 ? new Set(filter.state) : null;
  const staleCutoff =
    filter.staleDays !== undefined && filter.staleDays > 0
      ? now - filter.staleDays * MS_PER_DAY
      : null;
  const selected = rows.filter(
    (row) =>
      (!wantedStates || wantedStates.has(row.state)) &&
      (!filter.workspaceId || row.workspaceId === filter.workspaceId) &&
      (!filter.folder || folderMatches(row, filter.folder)) &&
      (staleCutoff === null || activityMs(row) <= staleCutoff),
  );
  const sorted = selected
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        STATE_RANK[a.row.state] - STATE_RANK[b.row.state] ||
        activityMs(b.row) - activityMs(a.row) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
  return filter.limit !== undefined && filter.limit > 0 ? sorted.slice(0, filter.limit) : sorted;
}

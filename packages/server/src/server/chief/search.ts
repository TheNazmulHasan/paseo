import {
  PRIVATE_TEXT_WITHHELD,
  type ChiefConfig,
  type PrivacyGuard,
} from "./privacy.js";
import {
  readTranscript,
  type TranscriptKind,
  type TranscriptLocator,
  type TranscriptMessage,
} from "./transcripts.js";

/**
 * Nazmul mod (chief): the search behind the `search_sessions` tool. Pure of Paseo types: it takes
 * the sessions to look in (already ordered, most recent first) and a transcript locator, so it is
 * tested with temp files.
 */

export const SNIPPET_LENGTH = 200;
export const DEFAULT_SEARCH_LIMIT = 20;
/** Stop scanning after this long and say so; a tool call must not hang the agent. */
export const DEFAULT_TIME_BUDGET_MS = 25_000;

export interface ParsedQuery {
  /** Lower-cased words, all of which must appear in a message. */
  words: string[];
  /** Lower-cased quoted phrases, each of which must appear as written (whitespace-folded). */
  phrases: string[];
}

/** `switchboard "quota check" router` gives words [switchboard, router], phrases ["quota check"]. */
export function parseQuery(query: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = query.replace(/"([^"]+)"/g, (_whole, phrase: string) => {
    const folded = foldSpaces(phrase).toLowerCase();
    if (folded) phrases.push(folded);
    return " ";
  });
  const words = rest
    .split(/\s+/)
    .map((word) => word.replace(/"/g, "").toLowerCase())
    .filter(Boolean);
  return { words, phrases };
}

function foldSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isEmptyQuery(parsed: ParsedQuery): boolean {
  return parsed.words.length === 0 && parsed.phrases.length === 0;
}

/** Case-insensitive; every word and every phrase must be present. Returns the folded text or null. */
function matchPosition(text: string, parsed: ParsedQuery): number | null {
  const folded = foldSpaces(text).toLowerCase();
  let first = Number.POSITIVE_INFINITY;
  for (const term of [...parsed.phrases, ...parsed.words]) {
    const at = folded.indexOf(term);
    if (at === -1) return null;
    first = Math.min(first, at);
  }
  return Number.isFinite(first) ? first : null;
}

/** About `SNIPPET_LENGTH` characters of the message around the first matched term. */
export function makeSnippet(text: string, parsed: ParsedQuery): string {
  const folded = foldSpaces(text);
  const lower = folded.toLowerCase();
  let at = Number.POSITIVE_INFINITY;
  for (const term of [...parsed.phrases, ...parsed.words]) {
    const found = lower.indexOf(term);
    if (found !== -1) at = Math.min(at, found);
  }
  if (!Number.isFinite(at)) at = 0;
  if (folded.length <= SNIPPET_LENGTH) return folded;
  const start = Math.max(0, Math.min(at - Math.floor(SNIPPET_LENGTH / 3), folded.length - SNIPPET_LENGTH));
  const end = Math.min(folded.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${folded.slice(start, end)}${end < folded.length ? "…" : ""}`;
}

export interface SearchableSession {
  agentId: string;
  title: string | null;
  workspaceId: string | null;
  /** The workspace title; "Debrief" is private. */
  workspaceTitle?: string | null;
  /** The agent's cwd, and the workspace's when it differs; both feed the privacy guard. */
  cwds: readonly (string | null | undefined)[];
  /** Provider session ids to look up, best first. */
  sessionIds: readonly string[];
  archived: boolean;
  lastActivityAt: string | null;
}

export interface SearchInput {
  query: string;
  includeArchived?: boolean;
  /** ISO date or timestamp. Messages before it are ignored. */
  since?: string;
  /** ISO date or timestamp. A bare date includes that whole day. */
  until?: string;
  workspaceId?: string;
  limit?: number;
}

export interface RawHit {
  session: SearchableSession;
  /** ISO time of the matching message (the session's last activity for a title match). */
  at: string | null;
  who: "you" | "agent" | "title";
  snippet: string;
  source: TranscriptKind | "title";
  private: boolean;
}

export interface SearchOutcome {
  hits: RawHit[];
  sessionsScanned: number;
  /** Sessions with no transcript anywhere (only their title was searched). */
  sessionsWithoutTranscript: number;
  /** True when the time budget ended the scan early. */
  partial: boolean;
  elapsedMs: number;
}

export function parseSince(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function parseUntil(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  // `2026-11-01` means through the end of that day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? ms + 24 * 60 * 60 * 1000 - 1 : ms;
}

function inRange(at: string | null, since: number | null, until: number | null): boolean {
  if (since === null && until === null) return true;
  if (!at) return true;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return true;
  return (since === null || ms >= since) && (until === null || ms <= until);
}

export interface SearchDeps {
  sessions: readonly SearchableSession[];
  locator: TranscriptLocator;
  guard: PrivacyGuard;
  config: ChiefConfig;
  now?: () => number;
  timeBudgetMs?: number;
}

/**
 * Scans sessions in the order given and stops at `limit` hits. One hit per session: the first
 * message in it that matches (so the date is when it was first said, inside any `since`/`until`
 * window). A session with no readable transcript is matched on its title alone.
 */
export async function searchSessions(deps: SearchDeps, input: SearchInput): Promise<SearchOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const limit = Math.max(1, input.limit ?? DEFAULT_SEARCH_LIMIT);
  const parsed = parseQuery(input.query);
  const since = parseSince(input.since);
  const until = parseUntil(input.until);
  const includeArchived = input.includeArchived ?? true;
  const outcome: SearchOutcome = {
    hits: [],
    sessionsScanned: 0,
    sessionsWithoutTranscript: 0,
    partial: false,
    elapsedMs: 0,
  };
  if (isEmptyQuery(parsed)) return outcome;

  for (const session of deps.sessions) {
    if (outcome.hits.length >= limit) break;
    if (now() - started > budget) {
      outcome.partial = true;
      break;
    }
    if (!includeArchived && session.archived) continue;
    if (input.workspaceId && session.workspaceId !== input.workspaceId) continue;

    const privacy = deps.guard.check({
      workspaceId: session.workspaceId,
      workspaceTitle: session.workspaceTitle,
      cwds: session.cwds,
    });
    const withhold = privacy.isPrivate && !deps.config.searchPrivateText;
    outcome.sessionsScanned += 1;

    let found: { message: TranscriptMessage; source: TranscriptKind } | null = null;
    let hadTranscript = false;
    for (const sessionId of session.sessionIds) {
      const ref = await deps.locator.find(sessionId, session.cwds.find(Boolean) ?? "/");
      if (!ref) continue;
      hadTranscript = true;
      try {
        for await (const message of readTranscript(ref)) {
          if (!inRange(message.at, since, until)) continue;
          if (matchPosition(message.text, parsed) === null) continue;
          found = { message, source: ref.kind };
          break;
        }
      } catch {
        // An unreadable transcript is a miss, not a failed search.
      }
      if (found) break;
    }
    if (!hadTranscript) outcome.sessionsWithoutTranscript += 1;

    if (found) {
      outcome.hits.push({
        session,
        at: found.message.at,
        who: found.message.who,
        snippet: withhold ? PRIVATE_TEXT_WITHHELD : makeSnippet(found.message.text, parsed),
        source: found.source,
        private: privacy.isPrivate,
      });
      continue;
    }

    // Title fallback: the only text some sessions have (Antigravity keeps no transcript).
    if (
      session.title &&
      inRange(session.lastActivityAt, since, until) &&
      matchPosition(session.title, parsed) !== null
    ) {
      outcome.hits.push({
        session,
        at: session.lastActivityAt,
        who: "title",
        snippet: withhold ? PRIVATE_TEXT_WITHHELD : session.title,
        source: "title",
        private: privacy.isPrivate,
      });
    }
  }
  outcome.elapsedMs = now() - started;
  return outcome;
}

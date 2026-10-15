import type { FileMentionRange } from "@/utils/file-mention-autocomplete";

/** How many sessions the `@` list shows. Files keep their own limit. */
export const SESSION_MENTION_LIMIT = 6;

const UNTITLED_SESSION_LABEL = "Untitled session";

export interface SessionMentionCandidate {
  agentId: string;
  title: string | null;
  lastActivityAt: Date | null;
  archivedAt?: Date | null;
  /** Working directory; its last segment tells two same-titled sessions apart. */
  cwd?: string;
}

export interface SessionMentionSuggestion {
  agentId: string;
  /** Single-line title shown in the list and inserted into the message. */
  title: string;
  /** Last segment of the session's working directory, when known. */
  workspaceHint: string | null;
}

function normalizeTitle(title: string | null): string {
  const single = (title ?? "").replace(/\s+/g, " ").trim();
  return single.length > 0 ? single : UNTITLED_SESSION_LABEL;
}

function lastPathSegment(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const segment = cwd.split(/[\\/]/).findLast((part) => part.length > 0);
  return segment ?? null;
}

function activityTime(candidate: SessionMentionCandidate): number {
  return candidate.lastActivityAt ? candidate.lastActivityAt.getTime() : Number.NEGATIVE_INFINITY;
}

/**
 * Sessions offered after `@`: not archived, not the session being typed into, matching the query
 * as a title substring or an id prefix (case-insensitive), most recently active first.
 */
export function filterSessionMentionSuggestions(input: {
  candidates: readonly SessionMentionCandidate[];
  query: string;
  excludeAgentId?: string;
  limit?: number;
}): SessionMentionSuggestion[] {
  const query = input.query.trim().toLowerCase();
  const limit = input.limit ?? SESSION_MENTION_LIMIT;
  const matches: Array<{ candidate: SessionMentionCandidate; title: string }> = [];
  for (const candidate of input.candidates) {
    if (candidate.archivedAt || candidate.agentId === input.excludeAgentId) continue;
    const title = normalizeTitle(candidate.title);
    if (
      query.length > 0 &&
      !title.toLowerCase().includes(query) &&
      !candidate.agentId.toLowerCase().startsWith(query)
    ) {
      continue;
    }
    matches.push({ candidate, title });
  }
  matches.sort((left, right) => activityTime(right.candidate) - activityTime(left.candidate));
  return matches.slice(0, limit).map(({ candidate, title }) => ({
    agentId: candidate.agentId,
    title,
    workspaceHint: lastPathSegment(candidate.cwd),
  }));
}

/** What lands in the message: `Title (full-agent-id)`. Agents act on ids, so never the short form. */
export function formatSessionMention(title: string, agentId: string): string {
  return `${normalizeTitle(title)} (${agentId})`;
}

export function applySessionMentionReplacement(input: {
  text: string;
  mention: FileMentionRange;
  title: string;
  agentId: string;
}): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatSessionMention(input.title, input.agentId)}${after}`;
}

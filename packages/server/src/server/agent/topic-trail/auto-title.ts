import { resolveCreateAgentTitles } from "../create-agent-title.js";
import type { HomeCard } from "@getpaseo/protocol/topic-trail";

/**
 * Nazmul mod (home-map): when may the daemon rename a session to the card's theme title?
 *
 * Paseo titles a new chat from the first line of its first prompt (cut at 60 characters), and
 * nothing ever replaces it, so the tab bar fills with "Check the u…". The card writes a real
 * theme name. The daemon applies it only when the CURRENT title is still that automatic one. Paseo
 * records no provenance for a title, so the rule is: a title that is neither the auto title nor a
 * raw prefix of the first message nor a bare id was set by a person or by an agent (`update_agent`
 * and the rename UI share one path), and is never touched. A session is renamed once
 * (`card.renamed`), never again.
 */

export const AUTO_TITLE_ENV = "PASEO_AUTO_TITLE";
/** A prefix match needs at least this many characters, so "Hi" never counts as a prefix of "Hi, can you...". */
const MIN_PREFIX_CHARS = 6;
export const MAX_THEME_TITLE_CHARS = 50;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:…|\.{3})$/u, "")
    .trimEnd()
    .toLowerCase();
}

/** Is `title` still what Paseo made on its own for this session? */
export function isAutoTitle(input: {
  title: string | null | undefined;
  /** Text of the session's FIRST user message; null when it is no longer in the timeline. */
  firstUserMessage: string | null;
  agentId: string;
}): boolean {
  const title = input.title?.trim() ?? "";
  if (title.length === 0) return true;
  if (title === input.agentId || title === input.agentId.slice(0, 8) || UUID.test(title)) {
    return true;
  }
  const first = input.firstUserMessage?.trim();
  if (!first) return false;
  const wanted = normalize(title);
  const provisional = resolveCreateAgentTitles({ initialPrompt: first }).provisionalTitle;
  if (provisional && normalize(provisional) === wanted) return true;
  return wanted.length >= MIN_PREFIX_CHARS && normalize(first).startsWith(wanted);
}

/** The theme title cut to a tab-sized name; null when the model gave nothing usable. */
export function cleanThemeTitle(raw: string | null | undefined): string | null {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[.:;,\s]+$/u, "");
  if (collapsed.length === 0) return null;
  return collapsed.length > MAX_THEME_TITLE_CHARS
    ? collapsed.slice(0, MAX_THEME_TITLE_CHARS).trimEnd()
    : collapsed;
}

/**
 * The rename to apply now, or null. Once only: a card that already carries `renamed` is never
 * renamed again, even if the title later drifts back to an auto-looking one.
 */
export function pickAutoRename(input: {
  enabled: boolean;
  card: Pick<HomeCard, "title" | "renamed">;
  currentTitle: string | null | undefined;
  firstUserMessage: string | null;
  agentId: string;
}): { from: string | null; to: string } | null {
  if (!input.enabled || input.card.renamed) return null;
  const to = cleanThemeTitle(input.card.title);
  if (!to) return null;
  const current = input.currentTitle?.trim() || null;
  if (current === to) return null;
  if (!isAutoTitle({ title: current, firstUserMessage: input.firstUserMessage, agentId: input.agentId })) {
    return null;
  }
  return { from: current, to };
}

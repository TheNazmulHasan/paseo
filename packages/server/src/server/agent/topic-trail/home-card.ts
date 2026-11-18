import { z } from "zod";
import { isCacheWarmPrompt, isCacheWarmReply } from "@getpaseo/protocol/agent-cache-warm";
import {
  HOME_CARD_IMPORTANCES,
  HOME_CARD_KINDS,
  HOME_CARD_URGENCIES,
  type HomeCard,
} from "@getpaseo/protocol/topic-trail";

/**
 * Nazmul mod (home-map): the session card, written in the same model call as the topic trail.
 * Everything here is pure: the answer shape, the keep-alive filter, the merge with the previous
 * card, and the prompt section. The service wires it to the model.
 */

/** Limits applied after the model answers; the schema below is looser so a long answer retries less. */
export const CARD_LIMITS = {
  title: 50,
  what: 60,
  status: 160,
  waitingOn: 40,
  nextStep: 90,
  why: 100,
  openItem: 100,
  openItems: 3,
} as const;

export const HomeCardModelSchema = z.object({
  title: z.string().min(1).max(200),
  what: z.string().min(1).max(200),
  status: z.string().max(400),
  waitingOn: z.string().min(1).max(100),
  kind: z.enum(HOME_CARD_KINDS),
  nextStep: z.string().max(300).nullable(),
  urgency: z.enum(HOME_CARD_URGENCIES),
  importance: z.enum(HOME_CARD_IMPORTANCES),
  why: z.string().max(300),
  looksFinished: z.boolean(),
  stopped: z.boolean(),
  /** Missing = "no change": the previous items are carried forward. */
  openItems: z.array(z.string().max(300)).max(8).optional(),
});
export type HomeCardModelResult = z.infer<typeof HomeCardModelSchema>;

// ---------------------------------------------------------------------------------------------
// Keep-alive turns
// ---------------------------------------------------------------------------------------------

/** The shape of a timeline row the card logic reads; `AgentTimelineRow` satisfies it. */
export interface CardRow {
  seq: number;
  timestamp: string;
  item: { type: string; text?: string };
}

/** The cache-warm ping ("AFK for a bit, keeping you alive...") or a custom prompt that says so. */
export function isKeepAlivePrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  return isCacheWarmPrompt(text) || /keeping you alive/i.test(text);
}

/**
 * Drops the cache-warm pings and their "ok" replies. They are not conversation: counted as "his
 * last message" they made ~15 old sessions read as "only keep-alive pings" (test 1, 2026-11-18).
 */
export function dropKeepAliveRows<T extends CardRow>(rows: readonly T[]): T[] {
  const kept: T[] = [];
  let afterPing = false;
  for (const row of rows) {
    const text = row.item.type === "user_message" ? row.item.text : undefined;
    if (row.item.type === "user_message") {
      if (isKeepAlivePrompt(text)) {
        afterPing = true;
        continue;
      }
      afterPing = false;
    } else if (afterPing && row.item.type === "assistant_message") {
      if (isCacheWarmReply(row.item.text)) continue;
      afterPing = false;
    }
    kept.push(row);
  }
  return kept;
}

/** The highest seq among real user and assistant messages; 0 when there are none. */
export function newestMessageSeq(rows: readonly CardRow[]): number {
  let max = 0;
  for (const row of rows) {
    if (
      (row.item.type === "user_message" || row.item.type === "assistant_message") &&
      (row.item.text ?? "").trim().length > 0 &&
      row.seq > max
    ) {
      max = row.seq;
    }
  }
  return max;
}

/** Nothing new since the card was written: no message newer than `card.basedOnSeq`. */
export function cardIsCurrent(card: HomeCard | null | undefined, newestSeq: number): boolean {
  return Boolean(card) && newestSeq <= card!.basedOnSeq;
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

function clean(raw: string, max: number): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}

function cleanOpenItems(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of raw) {
    const text = clean(item, CARD_LIMITS.openItem);
    if (text.length === 0 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    items.push(text);
    if (items.length >= CARD_LIMITS.openItems) break;
  }
  return items;
}

/**
 * The model's card, made safe to store. Open items are the running checklist: when the model does
 * not mention them they are carried forward from the previous card; when it returns a list (even
 * an empty one) that list is the new truth. A card with nothing for him carries no next step.
 */
export function mergeHomeCard(
  prev: HomeCard | null | undefined,
  result: HomeCardModelResult,
  basedOnSeq: number,
  now: Date,
): HomeCard {
  const nextStep = result.nextStep ? clean(result.nextStep, CARD_LIMITS.nextStep) : "";
  const kind = result.kind;
  const title = clean(result.title, CARD_LIMITS.title).replace(/[.:;,\s]+$/u, "");
  return {
    // A model answer with no usable title keeps the previous one.
    title: title || prev?.title,
    ...(prev?.renamed ? { renamed: prev.renamed } : {}),
    what: clean(result.what, CARD_LIMITS.what),
    status: clean(result.status, CARD_LIMITS.status),
    waitingOn: clean(result.waitingOn, CARD_LIMITS.waitingOn) || "nobody",
    kind,
    nextStep: kind === "none" || nextStep.length === 0 ? null : nextStep,
    urgency: result.urgency,
    importance: result.importance,
    why: clean(result.why, CARD_LIMITS.why),
    looksFinished: result.looksFinished,
    stopped: result.stopped,
    openItems: result.openItems ? cleanOpenItems(result.openItems) : cleanOpenItems(prev?.openItems ?? []),
    basedOnSeq: Math.max(basedOnSeq, 0),
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

export interface CardPromptContext {
  title: string | null;
  /** Agent lifecycle: idle | running | error | closed | initializing. */
  status: string;
  workspace: string | null;
  folder: string | null;
  lastSpeaker: "user" | "assistant" | null;
  /** Whole days since the last real message; null when unknown. */
  quietDays: number | null;
  previousCard: HomeCard | null;
  /** The text of `~/.paseo/home-priorities.md` when it exists. */
  priorities: string | null;
}

const PRIORITIES_CHARS = 3000;

/** The card rules: they sit with the other rules, above the source material. */
export function buildCardRules(): string[] {
  return [
    "",
    "Also write `card`, the session card for Nazmul's Home dashboard. Nazmul is the CEO of DeepCycle (an AI-agent company). He runs client work, builds his own tools (Paseo, MyOS), studies, and handles family errands. He opens Home to know, in one look, what waits on him, what to do next, and what he can close. The facts for it are under \"Session facts\" and \"Previous card\" below.",
    '- card.title: the THEME of the session as a name, 2 to 5 words, a noun phrase in plain words (for example "Google OAuth secret for Riajul", "Model picker struggles"). Never the first words of a message. Keep it stable: when the previous card\'s title still fits, reuse it word for word.',
    "- card.what: what the session is about, max 8 words, plain words, no jargon.",
    "- card.status: where it stands now, one short sentence.",
    '- card.waitingOn: who must act next. "nazmul" when he must act, decide, log in, approve, check or tell someone (the assistant\'s last reply ends asking him something, or hands him a task). A person\'s name when someone else owes the next move and he waits on them. "agent" when he spoke last and the assistant never answered (or it owes work). "nobody" when nothing is open. Seen or not does not matter.',
    '- card.kind: "decision" (he must choose), "task" (he must do something), "review" (he must read or check something), "none".',
    '- card.nextStep: his concrete next step, imperative, max 10 words (for example "Tell Riajul yes"), or null when kind is none.',
    '- card.urgency: "now" = a person waits on him, or something public, money or a deadline is live. "today" = blocks an agent or work he committed to. "week" = useful, nothing breaks. "whenever" = learning, ideas, nice-to-have. Learning reviews (twins, flashcards, weave or clicks files to read) are NEVER now or today.',
    '- card.importance: "high" = DeepCycle business, clients, money, people waiting, family duties. "medium" = his tools and setup. "low" = experiments, learning side-quests.',
    "- card.why: why this urgency, max 12 words.",
    "- card.looksFinished: true when the goal was reached or dropped and nothing is open. Be honest: many old sessions are done. Lean to true when the chat has been quiet for 3 or more days and nothing is asked of him.",
    "- card.stopped: true when the session ended in an error or was cut off mid-work (status error, no reply after his last message). A stopped session with nothing important pending also looksFinished.",
    "- card.openItems: at most 3 short things still open. Start from the previous open items and keep each one until a LATER message resolves it; add new ones the latest messages open.",
    "- Write the card as if to him: short, everyday English. Never invent facts that are not in the input.",
  ];
}

/** The facts the card is read from, listed with the other source material. */
export function buildCardFacts(context: CardPromptContext): string[] {
  const previous = context.previousCard
    ? JSON.stringify({
        title: context.previousCard.title,
        what: context.previousCard.what,
        status: context.previousCard.status,
        waitingOn: context.previousCard.waitingOn,
        nextStep: context.previousCard.nextStep,
        openItems: context.previousCard.openItems,
      })
    : "(none)";
  const lines = [
    "",
    "## Session facts",
    `title: ${context.title?.trim() || "(untitled)"}`,
    `status: ${context.status}`,
    `workspace: ${context.workspace ?? "(unknown)"}${context.folder ? ` in folder ${context.folder}` : ""}`,
    `lastSpeaker: ${context.lastSpeaker ?? "(none)"}`,
    `quietDays: ${context.quietDays === null ? "(unknown)" : context.quietDays}`,
    "",
    "## Previous card (running checklist, may be stale)",
    previous,
  ];
  const priorities = context.priorities?.trim();
  if (priorities) {
    lines.push(
      "",
      "## Nazmul's current priorities (from Chief; source material for judging urgency and importance)",
      priorities.length > PRIORITIES_CHARS ? `${priorities.slice(0, PRIORITIES_CHARS)}…` : priorities,
    );
  }
  return lines;
}

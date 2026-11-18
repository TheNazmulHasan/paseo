import { z } from "zod";

/**
 * Nazmul mod (topic-trail): the last few topics an agent session worked on, newest first,
 * plus an optional "your move" line (what the agent is waiting on from the user).
 * Server-written, stored with the agent record, optional on the wire so older clients and
 * servers stay compatible.
 */
export const TopicTrailTopicSchema = z.object({
  label: z.string(),
  /** Timeline seq of the user message where the topic began; null when unknown. */
  seq: z.number().nullable(),
  /** Timeline epoch that `seq` belongs to; null when unknown. */
  epoch: z.string().nullable(),
  /** ISO timestamp of the message where the topic began. */
  at: z.string(),
});

/**
 * Nazmul mod (home-map): the session card Home v2 is built from. Written in the same model call as
 * the topic trail and stored inside it, so it rides every path the trail already rides (agent
 * record, snapshot, list item, app replica cache). Every field is the model's reading of one
 * session, never a fact Paseo measured.
 */
export const HOME_CARD_KINDS = ["decision", "task", "review", "none"] as const;
export const HOME_CARD_URGENCIES = ["now", "today", "week", "whenever"] as const;
export const HOME_CARD_IMPORTANCES = ["high", "medium", "low"] as const;

export const HomeCardSchema = z.object({
  /**
   * The theme of the session as a name, 2-5 plain words ("Google OAuth secret for Riajul").
   * Optional only so cards stored before it existed stay valid. Home shows it as the item name.
   */
  title: z.string().optional(),
  /**
   * Set once the daemon has renamed the session to `title` because its own title was still the
   * automatic one (the first words of the first prompt). Its presence means "never rename again";
   * `from` is the title that was replaced.
   */
  renamed: z
    .object({ from: z.string().nullable(), to: z.string(), at: z.string() })
    .optional(),
  /** What the session is about, max 8 plain words. */
  what: z.string(),
  /** Where it stands now, one short sentence. */
  status: z.string(),
  /**
   * Who must act next: "nazmul" (he must act or decide), a person's name (he waits on that
   * person), "agent" (the agent owes work) or "nobody".
   */
  waitingOn: z.string(),
  kind: z.enum(HOME_CARD_KINDS),
  /** His concrete next step, imperative; null when none. */
  nextStep: z.string().nullable(),
  urgency: z.enum(HOME_CARD_URGENCIES),
  importance: z.enum(HOME_CARD_IMPORTANCES),
  /** Why this urgency, max 12 words. */
  why: z.string(),
  looksFinished: z.boolean(),
  /** Ended in an error or was cut off mid-work. */
  stopped: z.boolean(),
  /** Open items (max 3) carried forward until a later message resolves them. */
  openItems: z.array(z.string()),
  /** Highest message seq (user or assistant, keep-alive pings excluded) the card was read from. */
  basedOnSeq: z.number(),
  updatedAt: z.string(),
});

export const TopicTrailSchema = z.object({
  topics: z.array(TopicTrailTopicSchema),
  yourMove: z.string().nullable(),
  /** Highest user-message seq the trail has been computed from. */
  basedOnSeq: z.number(),
  updatedAt: z.string(),
  /** Nazmul mod (home-map): optional so older servers, clients and stored records stay valid. */
  card: HomeCardSchema.nullable().optional(),
});

export type TopicTrailTopic = z.infer<typeof TopicTrailTopicSchema>;
export type TopicTrail = z.infer<typeof TopicTrailSchema>;
export type HomeCard = z.infer<typeof HomeCardSchema>;

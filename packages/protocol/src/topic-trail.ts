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

export const TopicTrailSchema = z.object({
  topics: z.array(TopicTrailTopicSchema),
  yourMove: z.string().nullable(),
  /** Highest user-message seq the trail has been computed from. */
  basedOnSeq: z.number(),
  updatedAt: z.string(),
});

export type TopicTrailTopic = z.infer<typeof TopicTrailTopicSchema>;
export type TopicTrail = z.infer<typeof TopicTrailSchema>;

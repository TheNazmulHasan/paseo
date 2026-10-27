import type { TopicTrail, TopicTrailTopic } from "@getpaseo/protocol/topic-trail";

/** Nazmul mod (topic-trail): pure merge of a model answer into the stored trail. */

export const MAX_TOPICS = 3;
export const MAX_LABEL_CHARS = 40;
export const MAX_YOUR_MOVE_CHARS = 80;

export interface ModelTopicResult {
  topics: ReadonlyArray<{ label: string; startSeq: number }>;
  yourMove: string | null;
}

/** The user-message rows the model was shown, keyed by timeline seq. */
export type TrailRowsBySeq = ReadonlyMap<number, { timestamp: string }>;

function cleanLabel(raw: string): string {
  const collapsed = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,\s]+$/u, "");
  return collapsed.length > MAX_LABEL_CHARS
    ? collapsed.slice(0, MAX_LABEL_CHARS).trimEnd()
    : collapsed;
}

function cleanYourMove(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.length > MAX_YOUR_MOVE_CHARS
    ? `${collapsed.slice(0, MAX_YOUR_MOVE_CHARS - 1).trimEnd()}…`
    : collapsed;
}

function labelKey(label: string): string {
  return label.toLowerCase();
}

function resolveModelTopics(
  prev: TopicTrail | null,
  result: ModelTopicResult,
  rowsBySeq: TrailRowsBySeq,
  epoch: string | null,
  now: Date,
): TopicTrailTopic[] {
  const prevByLabel = new Map<string, TopicTrailTopic>(
    (prev?.topics ?? []).map((topic) => [labelKey(topic.label), topic]),
  );
  const topics: TopicTrailTopic[] = [];
  const seen = new Set<string>();

  for (const candidate of result.topics) {
    if (topics.length >= MAX_TOPICS) {
      break;
    }
    const label = cleanLabel(candidate.label);
    if (label.length === 0 || seen.has(labelKey(label))) {
      continue;
    }
    seen.add(labelKey(label));

    // A reused label keeps its original anchor: that is where the topic really began, which
    // may be older than the message window the model saw.
    const previous = prevByLabel.get(labelKey(label));
    const row = rowsBySeq.get(candidate.startSeq);
    if (previous) {
      topics.push({ ...previous, label });
    } else if (row) {
      topics.push({ label, seq: candidate.startSeq, epoch, at: row.timestamp });
    } else {
      topics.push({ label, seq: null, epoch: null, at: now.toISOString() });
    }
  }
  return topics;
}

/** Older topics fall outside the message window the model saw, so it cannot list them. */
function carryOlderTopics(
  topics: TopicTrailTopic[],
  prev: TopicTrail | null,
  windowMin: number | null,
): void {
  const seen = new Set(topics.map((topic) => labelKey(topic.label)));
  for (const topic of prev?.topics ?? []) {
    if (topics.length >= MAX_TOPICS) {
      return;
    }
    const outsideWindow = topic.seq === null || windowMin === null || topic.seq < windowMin;
    if (seen.has(labelKey(topic.label)) || !outsideWindow) {
      continue;
    }
    seen.add(labelKey(topic.label));
    topics.push(topic);
  }
}

export function mergeTopicTrail(
  prev: TopicTrail | null,
  result: ModelTopicResult,
  rowsBySeq: TrailRowsBySeq,
  epoch: string | null,
  now: Date,
): TopicTrail {
  const windowSeqs = [...rowsBySeq.keys()];
  const windowMin = windowSeqs.length > 0 ? Math.min(...windowSeqs) : null;
  const windowMax = windowSeqs.length > 0 ? Math.max(...windowSeqs) : null;

  const topics = resolveModelTopics(prev, result, rowsBySeq, epoch, now);
  if (topics.length === 0 && prev) {
    // Nothing usable from the model: keep what we had rather than blanking the trail.
    topics.push(...prev.topics.slice(0, MAX_TOPICS));
  } else {
    carryOlderTopics(topics, prev, windowMin);
  }

  return {
    topics,
    yourMove: cleanYourMove(result.yourMove),
    basedOnSeq: windowMax ?? prev?.basedOnSeq ?? 0,
    updatedAt: now.toISOString(),
  };
}

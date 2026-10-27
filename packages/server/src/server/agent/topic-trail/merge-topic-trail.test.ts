import { describe, expect, it } from "vitest";
import type { TopicTrail } from "@getpaseo/protocol/topic-trail";
import { mergeTopicTrail } from "./merge-topic-trail.js";

const NOW = new Date("2026-10-27T10:00:00.000Z");

function rows(...seqs: number[]) {
  return new Map(seqs.map((seq) => [seq, { timestamp: `2026-10-27T09:0${seq % 10}:00.000Z` }]));
}

function prevTrail(topics: TopicTrail["topics"]): TopicTrail {
  return { topics, yourMove: null, basedOnSeq: 20, updatedAt: "2026-10-26T00:00:00.000Z" };
}

describe("mergeTopicTrail", () => {
  it("anchors topics to the rows they start at and sets basedOnSeq to the newest row", () => {
    const trail = mergeTopicTrail(
      null,
      {
        topics: [
          { label: "Pricing meters", startSeq: 7 },
          { label: "Seats vs agents", startSeq: 3 },
        ],
        yourMove: "Assign DEE-41 to Atlas?",
      },
      rows(3, 5, 7),
      "epoch-1",
      NOW,
    );
    expect(trail.topics).toEqual([
      { label: "Pricing meters", seq: 7, epoch: "epoch-1", at: "2026-10-27T09:07:00.000Z" },
      { label: "Seats vs agents", seq: 3, epoch: "epoch-1", at: "2026-10-27T09:03:00.000Z" },
    ]);
    expect(trail.yourMove).toBe("Assign DEE-41 to Atlas?");
    expect(trail.basedOnSeq).toBe(7);
    expect(trail.updatedAt).toBe(NOW.toISOString());
  });

  it("drops an unknown startSeq to null instead of inventing an anchor", () => {
    const trail = mergeTopicTrail(
      null,
      { topics: [{ label: "Lost topic", startSeq: 99 }], yourMove: null },
      rows(1, 2),
      "e",
      NOW,
    );
    expect(trail.topics[0]).toEqual({
      label: "Lost topic",
      seq: null,
      epoch: null,
      at: NOW.toISOString(),
    });
  });

  it("keeps the original anchor when the model reuses a previous label", () => {
    const prev = prevTrail([{ label: "Pricing meters", seq: 2, epoch: "e0", at: "old" }]);
    const trail = mergeTopicTrail(
      prev,
      { topics: [{ label: "pricing meters", startSeq: 30 }], yourMove: null },
      rows(30, 31),
      "e1",
      NOW,
    );
    expect(trail.topics).toEqual([{ label: "pricing meters", seq: 2, epoch: "e0", at: "old" }]);
  });

  it("carries older previous topics that fall outside the message window", () => {
    const prev = prevTrail([
      { label: "Newer inside", seq: 12, epoch: "e", at: "a" },
      { label: "Old outside", seq: 2, epoch: "e", at: "b" },
      { label: "Older outside", seq: 1, epoch: "e", at: "c" },
    ]);
    const trail = mergeTopicTrail(
      prev,
      { topics: [{ label: "Brand new", startSeq: 40 }], yourMove: null },
      rows(10, 12, 40),
      "e",
      NOW,
    );
    expect(trail.topics.map((topic) => topic.label)).toEqual([
      "Brand new",
      "Old outside",
      "Older outside",
    ]);
  });

  it("dedupes labels, trims to 40 characters and caps at 3 topics", () => {
    const trail = mergeTopicTrail(
      null,
      {
        topics: [
          { label: "One.", startSeq: 4 },
          { label: "one", startSeq: 3 },
          { label: "Two ".repeat(20), startSeq: 2 },
          { label: "Three", startSeq: 1 },
          { label: "Four", startSeq: 1 },
        ],
        yourMove: "  ",
      },
      rows(1, 2, 3, 4),
      "e",
      NOW,
    );
    expect(trail.topics).toHaveLength(3);
    expect(trail.topics[0]?.label).toBe("One");
    expect(trail.topics[1]?.label.length).toBeLessThanOrEqual(40);
    expect(trail.yourMove).toBeNull();
  });

  it("keeps the previous topics when the model returns none", () => {
    const prev = prevTrail([{ label: "Kept", seq: 12, epoch: "e", at: "a" }]);
    const trail = mergeTopicTrail(prev, { topics: [], yourMove: "Reply?" }, rows(12, 13), "e", NOW);
    expect(trail.topics.map((topic) => topic.label)).toEqual(["Kept"]);
    expect(trail.yourMove).toBe("Reply?");
    expect(trail.basedOnSeq).toBe(13);
  });
});

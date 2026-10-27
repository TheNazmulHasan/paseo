import { describe, expect, it } from "vitest";
import { AgentListItemPayloadSchema, AgentSnapshotPayloadSchema } from "./messages.js";
import { TopicTrailSchema } from "./topic-trail.js";

const trail = {
  topics: [{ label: "Pricing meters", seq: 4, epoch: "e1", at: "2026-10-27T09:00:00.000Z" }],
  yourMove: null,
  basedOnSeq: 4,
  updatedAt: "2026-10-27T09:01:00.000Z",
};

describe("topic trail schema", () => {
  it("accepts a trail with unanchored topics", () => {
    expect(TopicTrailSchema.parse(trail)).toEqual(trail);
    const unanchored = { ...trail, topics: [{ label: "X", seq: null, epoch: null, at: "t" }] };
    expect(TopicTrailSchema.parse(unanchored).topics[0]?.seq).toBeNull();
  });

  it("is optional on the snapshot and list item so older peers stay compatible", () => {
    const listItem = {
      id: "a",
      shortId: "a",
      title: null,
      provider: "claude",
      model: null,
      status: "idle",
      cwd: "/x",
      createdAt: "t",
      updatedAt: "t",
      lastUserMessageAt: null,
    };
    expect(AgentListItemPayloadSchema.parse(listItem).topicTrail).toBeUndefined();
    expect(AgentListItemPayloadSchema.parse({ ...listItem, topicTrail: trail }).topicTrail).toEqual(
      trail,
    );
    expect(AgentSnapshotPayloadSchema.shape.topicTrail.safeParse(undefined).success).toBe(true);
    expect(AgentSnapshotPayloadSchema.shape.topicTrail.safeParse(null).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { TopicTrail } from "@getpaseo/protocol/topic-trail";
import { selectVisibleYourMove } from "./topic-trail-model";

const trail: TopicTrail = {
  topics: [{ label: "Pricing meters", seq: 4, epoch: "e", at: "2026-10-27T09:00:00.000Z" }],
  yourMove: "Assign DEE-41 to Atlas?",
  basedOnSeq: 4,
  updatedAt: "2026-10-27T09:01:00.000Z",
};

describe("selectVisibleYourMove", () => {
  it("shows the move while the agent is waiting", () => {
    expect(selectVisibleYourMove(trail, false)).toBe("Assign DEE-41 to Atlas?");
  });

  it("hides the move while the agent is running, or without a trail or move", () => {
    expect(selectVisibleYourMove(trail, true)).toBeNull();
    expect(selectVisibleYourMove(null, false)).toBeNull();
    expect(selectVisibleYourMove({ ...trail, yourMove: null }, false)).toBeNull();
    expect(selectVisibleYourMove({ ...trail, yourMove: "  " }, false)).toBeNull();
  });
});

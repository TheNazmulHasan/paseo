import { describe, expect, it } from "vitest";
import type { BoardSummary } from "@/boards/types";
import {
  buildBoardsCommandCenterContributions,
  type BoardsCommandCenterSource,
} from "./boards-contributions";

const views: BoardSummary[] = [
  { id: "live", name: "Live", kind: "live", sessionCount: 3 },
  { id: "b1", name: "api | web", kind: "user", sessionCount: 2 },
  { id: "b2", name: "docs | cli", kind: "user", sessionCount: 1 },
];

function setup(list: readonly BoardSummary[] = views) {
  const calls: string[] = [];
  const source: BoardsCommandCenterSource = {
    labels: {
      section: "Views",
      split: "Split workspaces…",
      openLive: "Open Live view",
      openView: (name) => `Open view: ${name}`,
    },
    icons: {},
    shortcuts: { split: [["mod", "ctrl", "V"]] },
    views: list,
    openSplitPicker: () => calls.push("split"),
    openView: (id) => calls.push(`open:${id}`),
  };
  return { calls, contributions: buildBoardsCommandCenterContributions(source) };
}

describe("buildBoardsCommandCenterContributions", () => {
  it("offers split, Live and one entry per saved split", () => {
    const { contributions } = setup();
    expect(contributions.map((entry) => entry.id)).toEqual([
      "views:split",
      "views:open-live",
      "views:open:b1",
      "views:open:b2",
    ]);
    expect(
      contributions.map((entry) =>
        entry.presentation.kind === "action" ? entry.presentation.title : null,
      ),
    ).toEqual([
      "Split workspaces…",
      "Open Live view",
      "Open view: api | web",
      "Open view: docs | cli",
    ]);
  });

  it("shows split and Live without a query, and saved views only when searching", () => {
    const { contributions } = setup();
    expect(contributions.map((entry) => entry.visibility)).toEqual([
      "always",
      "always",
      "query",
      "query",
    ]);
  });

  it("carries the split shortcut", () => {
    const [split] = setup().contributions;
    expect(split.presentation.kind === "action" && split.presentation.shortcutKeys).toEqual([
      ["mod", "ctrl", "V"],
    ]);
  });

  it("runs the picker and opens the right view", () => {
    const { calls, contributions } = setup();
    for (const entry of contributions) {
      void entry.run();
    }
    expect(calls).toEqual(["split", "open:live", "open:b1", "open:b2"]);
  });

  it("omits Live when it has not been created yet", () => {
    const { contributions } = setup([views[1]]);
    expect(contributions.map((entry) => entry.id)).toEqual(["views:split", "views:open:b1"]);
  });
});

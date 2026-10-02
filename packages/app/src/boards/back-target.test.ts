import { beforeEach, describe, expect, it } from "vitest";
import {
  getPreviousNonBoardPathname,
  rememberNonBoardPathname,
  resetPreviousNonBoardPathname,
} from "@/boards/back-store";
import { resolveBoardBackTarget, resolveBoardFocusedWorkspace } from "@/boards/back-target";
import {
  addSessionsToBoardModel,
  createEmptyBoardLayout,
  selectBoardTabModel,
} from "@/boards/model";
import type { Board } from "@/boards/types";
import { collectAllPanes } from "@/stores/workspace-layout-actions";

const FOCUSED = { serverId: "s1", workspaceId: "w1" };

describe("resolveBoardBackTarget", () => {
  it("returns to the route the user was on before the view", () => {
    expect(
      resolveBoardBackTarget({
        previousPathname: "/h/s9/workspace/w9",
        focusedWorkspace: FOCUSED,
      }),
    ).toEqual({ kind: "route", pathname: "/h/s9/workspace/w9" });
  });

  it("falls back to the focused pane's workspace when there is no previous route", () => {
    expect(resolveBoardBackTarget({ previousPathname: null, focusedWorkspace: FOCUSED })).toEqual({
      kind: "workspace",
      ...FOCUSED,
    });
  });

  it("never treats a view as the place to go back to", () => {
    expect(
      resolveBoardBackTarget({ previousPathname: "/boards/live", focusedWorkspace: FOCUSED }),
    ).toEqual({ kind: "workspace", ...FOCUSED });
    expect(resolveBoardBackTarget({ previousPathname: "", focusedWorkspace: null })).toBeNull();
  });

  it("is null when there is neither a previous route nor a focused workspace", () => {
    expect(resolveBoardBackTarget({ previousPathname: null, focusedWorkspace: null })).toBeNull();
  });
});

describe("resolveBoardFocusedWorkspace", () => {
  function boardOf(): Board {
    const empty: Board = {
      id: "b",
      name: "B",
      createdAt: 1,
      kind: "user",
      layout: createEmptyBoardLayout(),
      splitSizes: {},
      origins: {},
    };
    return addSessionsToBoardModel(empty, [
      { serverId: "s1", workspaceId: "w1", agentId: "a" },
      { serverId: "s2", workspaceId: "w2", path: "x.ts" },
    ]).board;
  }

  it("is the workspace of the tab showing in the focused pane, agent or file", () => {
    const board = boardOf();
    expect(resolveBoardFocusedWorkspace(board)).toEqual({ serverId: "s2", workspaceId: "w2" });
    const pane = collectAllPanes(board.layout.root)[0]!;
    const agentTab = pane.tabIds.find((id) => board.origins[id]?.agentId === "a")!;
    expect(resolveBoardFocusedWorkspace(selectBoardTabModel(board, pane.id, agentTab))).toEqual({
      serverId: "s1",
      workspaceId: "w1",
    });
  });

  it("is null for an empty board", () => {
    const empty: Board = { ...boardOf(), layout: createEmptyBoardLayout(), origins: {} };
    expect(resolveBoardFocusedWorkspace(empty)).toBeNull();
  });
});

describe("previous non-view route", () => {
  beforeEach(resetPreviousNonBoardPathname);

  it("remembers the last route that is not a view", () => {
    expect(rememberNonBoardPathname("/h/s1/workspace/w1")).toBe(true);
    expect(rememberNonBoardPathname("/boards/b1")).toBe(false);
    expect(rememberNonBoardPathname("")).toBe(false);
    expect(getPreviousNonBoardPathname()).toBe("/h/s1/workspace/w1");
  });
});

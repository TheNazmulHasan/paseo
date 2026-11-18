import { describe, expect, it } from "vitest";
import { createChiefCommand } from "./index.js";
import { oneLine, parseLimit } from "./shared.js";
import { parseStates, statesSchema, type SessionStateRow } from "./states.js";
import { searchSchema, type SearchHitRow } from "./search.js";
import { runHomeLayout, toHomeRow } from "./home.js";

function catchError(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("chief command", () => {
  function parse(argv: string[]): unknown {
    const chief = createChiefCommand()
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });
    for (const command of chief.commands) command.exitOverride();
    return catchError(() => chief.parse(argv, { from: "user" }));
  }

  it("has states and search", () => {
    expect(createChiefCommand().commands.map((command) => command.name())).toEqual([
      "states",
      "search",
      "home",
    ]);
    expect(
      createChiefCommand()
        .commands.find((command) => command.name() === "home")
        ?.commands.map((command) => command.name()),
    ).toEqual(["refresh", "snooze", "layout"]);
  });

  it("search needs its query as one argument, so an unquoted multi-word query is refused", () => {
    expect(parse(["search"])).toMatchObject({ code: "commander.missingArgument" });
    expect(parse(["search", "two", "words"])).toMatchObject({ code: "commander.excessArguments" });
  });

  it("states takes no positional arguments", () => {
    expect(parse(["states", "extra"])).toMatchObject({ code: "commander.excessArguments" });
  });
});

describe("argument parsing", () => {
  it("parses a comma separated state list and refuses unknown states", () => {
    expect(parseStates("your_move, needs_you")).toEqual(["your_move", "needs_you"]);
    expect(parseStates("stopped")).toEqual(["stopped"]);
    expect(parseStates(undefined)).toBeUndefined();
    expect(catchError(() => parseStates("done"))).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("parses --limit as a positive whole number", () => {
    expect(parseLimit("20")).toBe(20);
    expect(parseLimit(undefined)).toBeUndefined();
    expect(catchError(() => parseLimit("0"))).toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(catchError(() => parseLimit("x"))).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("folds table cells to one line", () => {
    expect(oneLine("a\n  b", 10)).toBe("a b");
    expect(oneLine("abcdefghij", 5)).toBe("abcd…");
    expect(oneLine(null, 5)).toBe("");
  });
});

describe("table rows", () => {
  it("states rows show state, title, workspace, folder, activity, your move and a short id", () => {
    const row: SessionStateRow = {
      agentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      title: "Quran flashcards",
      state: "your_move",
      workspaceTitle: "Faith",
      folder: null,
      lastActivityAt: "2026-11-16T03:02:57.268Z",
      yourMoveText: "Pick a deck",
    };
    const cells = statesSchema.columns.map((column) =>
      typeof column.field === "function" ? column.field(row) : row[column.field],
    );
    expect(cells).toEqual([
      "your_move",
      "Quran flashcards",
      "Faith",
      "Unfiled",
      "2026-11-16 03:02",
      "Pick a deck",
      "12345678",
    ]);
  });

  it("search rows show date, who, title, workspace, snippet and a short id", () => {
    const row: SearchHitRow = {
      agentId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      title: null,
      workspaceTitle: "MyOS",
      folder: null,
      archived: true,
      date: "2026-11-02T09:00:00.000Z",
      who: "you",
      snippet: "how does the switchboard pick an account?",
      source: "claude",
      private: false,
      url: null,
    };
    const cells = searchSchema.columns.map((column) =>
      typeof column.field === "function" ? column.field(row) : row[column.field],
    );
    expect(cells).toEqual([
      "2026-11-02",
      "you",
      "12345678",
      "MyOS",
      "how does the switchboard pick an account?",
      "12345678",
    ]);
  });
});

describe("home subcommands", () => {
  function parseHome(argv: string[]): unknown {
    const chief = createChiefCommand()
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });
    const home = chief.commands.find((command) => command.name() === "home")!;
    home.exitOverride();
    for (const command of home.commands) command.exitOverride();
    return catchError(() => chief.parse(["home", ...argv], { from: "user" }));
  }

  it("snooze needs an id and a time", () => {
    expect(parseHome(["snooze"])).toMatchObject({ code: "commander.missingArgument" });
    expect(parseHome(["snooze", "abc"])).toMatchObject({ code: "commander.missingArgument" });
  });

  it("layout needs --file or --clear, and not both", () => {
    expect(catchError(() => runHomeLayout({ daemonTarget: {} as never }, {} as never))).toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
    expect(
      catchError(() => runHomeLayout({ clear: true, file: "x.json", daemonTarget: {} as never }, {} as never)),
    ).toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(
      catchError(() => runHomeLayout({ file: "/nonexistent/layout.json", daemonTarget: {} as never }, {} as never)),
    ).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("shows the headline, brief time, counts and layout", () => {
    const row = toHomeRow({
      brief: { headline: "Two replies wait.", since: null, queue: [], checkOn: [], superseded: [], generatedAt: "2026-11-18T08:31:00.000Z" },
      state: {
        snoozed: { a: "x", b: "y" },
        kept: { c: "z" },
        chiefLayout: { title: "Your 10", reason: "r", createdAt: "x", groups: [] },
      },
      closedToday: 4,
      briefRunning: true,
      updatedAt: "x",
    });
    expect(row).toMatchObject({ headline: "Two replies wait.", closedToday: 4, snoozed: 2, kept: 1, layout: "Your 10", briefRunning: true });
    expect(toHomeRow({ brief: null, state: { snoozed: {}, kept: {}, chiefLayout: null }, closedToday: 0, briefRunning: false, updatedAt: "x" }).headline).toBe("(no brief yet)");
  });
});

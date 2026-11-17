import { describe, expect, it } from "vitest";
import type { Folder } from "@getpaseo/protocol/folders";
import { createFolderCommand } from "./index.js";
import { parseFolderSetArgs } from "./set.js";
import { countItems, requireFolder } from "./shared.js";

function catchError(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

const folders: Folder[] = [
  { id: "fld_0123456789abcdef", name: "Faith", emoji: "🕌", order: 0, createdAt: "2026-11-17" },
  {
    id: "fld_fedcba9876543210",
    name: "Work Stuff",
    emoji: null,
    order: 1,
    createdAt: "2026-11-17",
  },
];

describe("folder set arguments", () => {
  it("takes a folder, then workspace ids, dropping repeats", () => {
    expect(parseFolderSetArgs(["Faith", "wks_a", " wks_b ", "wks_a"], false)).toEqual({
      folderRef: "Faith",
      workspaceIds: ["wks_a", "wks_b"],
    });
  });

  it("with --unfiled every argument is a workspace id", () => {
    expect(parseFolderSetArgs(["wks_a", "wks_b"], true)).toEqual({
      folderRef: null,
      workspaceIds: ["wks_a", "wks_b"],
    });
  });

  it("needs at least one workspace id", () => {
    expect(catchError(() => parseFolderSetArgs(["Faith"], false))).toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
    expect(catchError(() => parseFolderSetArgs([], true))).toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
  });
});

describe("folder lookup", () => {
  it("finds a folder by id or by name in any case", () => {
    expect(requireFolder(folders, "fld_fedcba9876543210").name).toBe("Work Stuff");
    expect(requireFolder(folders, " work stuff ").id).toBe("fld_fedcba9876543210");
  });

  it("says so when there is no such folder", () => {
    expect(catchError(() => requireFolder(folders, "Nope"))).toMatchObject({
      code: "FOLDER_NOT_FOUND",
    });
  });

  it("counts a folder's items from the membership map", () => {
    expect(countItems({ a: "x", b: "y", c: "x" }, "x")).toBe(2);
  });
});

describe("folder command", () => {
  function parse(argv: string[]): unknown {
    const folder = createFolderCommand()
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });
    for (const command of folder.commands) command.exitOverride();
    return catchError(() => folder.parse(argv, { from: "user" }));
  }

  it("has ls, create, set, rm and rename", () => {
    expect(createFolderCommand().commands.map((command) => command.name())).toEqual([
      "ls",
      "create",
      "set",
      "rm",
      "rename",
    ]);
  });

  it("rejects an unquoted multi-word name instead of dropping words", () => {
    expect(parse(["create", "Work", "Stuff"])).toMatchObject({
      code: "commander.excessArguments",
    });
    expect(parse(["rename", "Faith", "New", "Name"])).toMatchObject({
      code: "commander.excessArguments",
    });
  });
});

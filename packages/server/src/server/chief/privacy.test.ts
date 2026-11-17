import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILTIN_PRIVATE_WORKSPACE_IDS,
  PRIVATE_TEXT_WITHHELD,
  createPrivacyGuard,
  readChiefConfig,
} from "./privacy.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "chief-privacy-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const SAFE = { searchPrivateText: false, privateWorkspaceIds: [] as string[] };

describe("createPrivacyGuard", () => {
  it("a .local-only marker in a parent folder makes every cwd below it private", () => {
    mkdirSync(path.join(root, "personal", "notes", "deep"), { recursive: true });
    writeFileSync(path.join(root, "personal", ".local-only"), "why");
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ cwds: [path.join(root, "personal", "notes", "deep")] }).isPrivate).toBe(true);
    expect(guard.check({ cwds: [path.join(root, "personal")] }).isPrivate).toBe(true);
  });

  it("a .private-project marker does NOT make a folder private (exam/ may go through the pool)", () => {
    mkdirSync(path.join(root, "exam", "sub"), { recursive: true });
    writeFileSync(path.join(root, "exam", ".private-project"), "");
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ cwds: [path.join(root, "exam", "sub")] }).isPrivate).toBe(false);
  });

  it("a folder whose name contains (local-only) is private with no marker file", () => {
    const personal = path.join(root, "exam", "08 - Personal (local-only)", "Profile");
    mkdirSync(personal, { recursive: true });
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ cwds: [personal] }).isPrivate).toBe(true);
    expect(guard.check({ cwds: [path.join(root, "exam")] }).isPrivate).toBe(false);
  });

  it("a workspace titled Debrief is private, whatever its id or cwd", () => {
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ workspaceId: "wks_x", workspaceTitle: " debrief ", cwds: [root] }).isPrivate).toBe(true);
    expect(guard.check({ workspaceId: "wks_x", workspaceTitle: "Debrief notes", cwds: [root] }).isPrivate).toBe(false);
  });

  it("a folder with no marker above it is not private", () => {
    mkdirSync(path.join(root, "open", "x"), { recursive: true });
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ cwds: [path.join(root, "open", "x")] }).isPrivate).toBe(false);
  });

  it("a symlink into a marked folder is private (the realpath is walked)", () => {
    mkdirSync(path.join(root, "real"), { recursive: true });
    writeFileSync(path.join(root, "real", ".local-only"), "");
    mkdirSync(path.join(root, "study"), { recursive: true });
    symlinkSync(path.join(root, "real"), path.join(root, "study", "08 - Personal"));
    const guard = createPrivacyGuard({ config: SAFE });
    expect(guard.check({ cwds: [path.join(root, "study", "08 - Personal")] }).isPrivate).toBe(true);
  });

  it("the Debrief workspace is private whatever its cwd", () => {
    mkdirSync(path.join(root, "exam"), { recursive: true });
    const guard = createPrivacyGuard({ config: SAFE });
    expect(BUILTIN_PRIVATE_WORKSPACE_IDS).toContain("wks_234bcdec1e111677");
    expect(
      guard.check({ workspaceId: "wks_234bcdec1e111677", cwds: [path.join(root, "exam")] }).isPrivate,
    ).toBe(true);
    expect(guard.check({ workspaceId: "wks_other", cwds: [path.join(root, "exam")] }).isPrivate).toBe(
      false,
    );
  });

  it("chief.json privateWorkspaceIds marks workspaces private even when no marker can cover their cwd", () => {
    const guard = createPrivacyGuard({ config: { ...SAFE, privateWorkspaceIds: ["wks_health"] } });
    expect(guard.check({ workspaceId: "wks_health", cwds: [] }).isPrivate).toBe(true);
  });

  it("an agent cwd OR the workspace cwd being private is enough", () => {
    mkdirSync(path.join(root, "priv"), { recursive: true });
    mkdirSync(path.join(root, "pub"), { recursive: true });
    writeFileSync(path.join(root, "priv", ".local-only"), "");
    const guard = createPrivacyGuard({ config: SAFE });
    expect(
      guard.check({ cwds: [path.join(root, "pub"), path.join(root, "priv")] }).isPrivate,
    ).toBe(true);
  });

  it("anonymised copies under /tmp/anon-* are never private, even with a copied marker", () => {
    const marked = new Set<string>();
    const guard = createPrivacyGuard({
      config: SAFE,
      markerExists: (p) => marked.has(p),
    });
    marked.add("/tmp/anon-job/.local-only");
    expect(guard.check({ cwds: ["/tmp/anon-job"] }).isPrivate).toBe(false);
    marked.add("/private/tmp/anon-job/.local-only");
    expect(guard.check({ cwds: ["/private/tmp/anon-job/sub"] }).isPrivate).toBe(false);
  });

  it("walks all the way up to /", () => {
    const seen: string[] = [];
    const guard = createPrivacyGuard({
      config: SAFE,
      markerExists: (p) => {
        seen.push(p);
        return false;
      },
    });
    guard.check({ cwds: ["/a/b/c"] });
    expect(seen).toContain("/.local-only");
    expect(seen).toContain("/a/.local-only");
    expect(seen).not.toContain("/a/.private-project");
  });
});

describe("readChiefConfig", () => {
  it("defaults to withholding when the file is missing", () => {
    expect(readChiefConfig(root)).toEqual({ searchPrivateText: false, privateWorkspaceIds: [] });
    expect(readChiefConfig(undefined).searchPrivateText).toBe(false);
  });

  it("only a literal true lifts the guard", () => {
    writeFileSync(path.join(root, "chief.json"), JSON.stringify({ searchPrivateText: true }));
    expect(readChiefConfig(root).searchPrivateText).toBe(true);
    writeFileSync(path.join(root, "chief.json"), JSON.stringify({ searchPrivateText: "yes" }));
    expect(readChiefConfig(root).searchPrivateText).toBe(false);
  });

  it("a broken file keeps the guard on", () => {
    writeFileSync(path.join(root, "chief.json"), "{not json");
    expect(readChiefConfig(root).searchPrivateText).toBe(false);
  });

  it("reads privateWorkspaceIds and ignores non-strings", () => {
    writeFileSync(path.join(root, "chief.json"), JSON.stringify({ privateWorkspaceIds: ["wks_h", 3] }));
    expect(readChiefConfig(root).privateWorkspaceIds).toEqual(["wks_h"]);
  });

  it("exports the withheld text the tool returns", () => {
    expect(PRIVATE_TEXT_WITHHELD).toBe("(private workspace — text withheld)");
  });
});

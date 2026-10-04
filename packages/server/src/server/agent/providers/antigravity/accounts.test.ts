import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AccountRegistryReader,
  accountDisplayName,
  findMainAccount,
  parseAccountRegistry,
} from "./accounts.js";

const HOME = "/Users/tester";

describe("parseAccountRegistry", () => {
  it("parses the documented shape and keeps order, email and notebookProfile", () => {
    const accounts = parseAccountRegistry(
      JSON.stringify({
        accounts: [
          { id: "main", email: "a@gmail.com", home: HOME, enabled: true },
          {
            id: "cseru",
            email: "b@gmail.com",
            home: `${HOME}/.agy-accounts/cseru`,
            enabled: false,
            notebookProfile: "cseru",
          },
        ],
      }),
      { homeDir: HOME },
    );
    expect(accounts).toEqual([
      { id: "main", email: "a@gmail.com", home: HOME, enabled: true },
      {
        id: "cseru",
        email: "b@gmail.com",
        home: `${HOME}/.agy-accounts/cseru`,
        enabled: false,
        notebookProfile: "cseru",
      },
    ]);
  });

  it("skips invalid entries and duplicate ids but keeps the valid ones", () => {
    const accounts = parseAccountRegistry(
      JSON.stringify({
        accounts: [
          { id: "main", home: HOME },
          { id: "bad id!", home: HOME },
          { id: "norelative", home: "relative/path" },
          { id: "main", home: "/elsewhere" },
          "not an object",
          { id: "tilde", home: "~/.agy-accounts/tilde", enabled: true },
        ],
      }),
      { homeDir: HOME },
    );
    expect(accounts?.map((a) => a.id)).toEqual(["main", "tilde"]);
    expect(accounts?.[1]?.home).toBe(`${HOME}/.agy-accounts/tilde`);
  });

  it("returns null for invalid JSON, wrong shape, or no valid entry", () => {
    expect(parseAccountRegistry("{nope", { homeDir: HOME })).toBeNull();
    expect(parseAccountRegistry(JSON.stringify({ accounts: "x" }), { homeDir: HOME })).toBeNull();
    expect(parseAccountRegistry(JSON.stringify({ accounts: [{}] }), { homeDir: HOME })).toBeNull();
  });
});

describe("AccountRegistryReader", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "agy-registry-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to a single implicit main account at the real home when the file is missing", () => {
    const reader = new AccountRegistryReader({
      filePath: path.join(dir, "google-accounts.json"),
      homeDir: HOME,
    });
    expect(reader.read()).toEqual({
      all: [{ id: "main", home: HOME, enabled: true }],
      enabled: [{ id: "main", home: HOME, enabled: true }],
      implicit: true,
    });
  });

  it("falls back to implicit main when the file is invalid", () => {
    const filePath = path.join(dir, "google-accounts.json");
    writeFileSync(filePath, "not json");
    const registry = new AccountRegistryReader({ filePath, homeDir: HOME }).read();
    expect(registry.implicit).toBe(true);
    expect(registry.enabled.map((a) => a.id)).toEqual(["main"]);
  });

  it("filters disabled accounts and re-reads when the file changes (no restart)", () => {
    const filePath = path.join(dir, "google-accounts.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        accounts: [
          { id: "main", home: HOME },
          { id: "off", home: "/x/off", enabled: false },
        ],
      }),
    );
    const reader = new AccountRegistryReader({ filePath, homeDir: HOME });
    expect(reader.read().enabled.map((a) => a.id)).toEqual(["main"]);

    writeFileSync(
      filePath,
      JSON.stringify({
        accounts: [
          { id: "main", home: HOME },
          { id: "cseru", home: "/x/cseru" },
        ],
      }),
    );
    const future = new Date(Date.now() + 5_000);
    utimesSync(filePath, future, future);
    expect(reader.read().enabled.map((a) => a.id)).toEqual(["main", "cseru"]);
  });
});

describe("account helpers", () => {
  it("labels with the email local part, else the id", () => {
    expect(
      accountDisplayName({ id: "x", email: "spare.one@gmail.com", home: "/h", enabled: true }),
    ).toBe("spare.one");
    expect(accountDisplayName({ id: "x", home: "/h", enabled: true })).toBe("x");
  });

  it("finds main by id, then by real home, then the first account", () => {
    const a = { id: "a", home: "/a", enabled: true };
    const real = { id: "real", home: HOME, enabled: true };
    const main = { id: "main", home: "/m", enabled: true };
    expect(findMainAccount([a, real, main], HOME)).toBe(main);
    expect(findMainAccount([a, real], HOME)).toBe(real);
    expect(findMainAccount([a], HOME)).toBe(a);
  });
});

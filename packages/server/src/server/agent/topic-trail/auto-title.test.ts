import { describe, expect, it } from "vitest";
import { cleanThemeTitle, isAutoTitle, pickAutoRename } from "./auto-title.js";

const AGENT = "3f2a9c10-1111-4222-8333-444455556666";

describe("isAutoTitle", () => {
  const first = "Riyajul asking me this. Do we have it?\nMore detail on the next line.";

  it("is true for no title and for a bare id or uuid", () => {
    expect(isAutoTitle({ title: null, firstUserMessage: first, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: "  ", firstUserMessage: first, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: AGENT, firstUserMessage: null, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: "3f2a9c10", firstUserMessage: null, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: "a1b2c3d4-0000-4000-8000-123456789abc", firstUserMessage: null, agentId: "other" })).toBe(true);
  });

  it("is true for exactly what create-agent-title derives from the first prompt", () => {
    expect(
      isAutoTitle({ title: "Riyajul asking me this. Do we have it?", firstUserMessage: first, agentId: AGENT }),
    ).toBe(true);
  });

  it("is true for the 60-character cut of a long first line", () => {
    const long = "In the model selection on Paseo, I'm struggling a lot. The picker never shows my account.";
    expect(
      isAutoTitle({ title: long.slice(0, 60).trim(), firstUserMessage: long, agentId: AGENT }),
    ).toBe(true);
  });

  it("is true for a raw prefix of the first message, with or without an ellipsis", () => {
    expect(isAutoTitle({ title: "Riyajul asking me", firstUserMessage: first, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: "Riyajul asking me…", firstUserMessage: first, agentId: AGENT })).toBe(true);
    expect(isAutoTitle({ title: "riyajul   ASKING me", firstUserMessage: first, agentId: AGENT })).toBe(true);
  });

  it("is false for a title a person or an agent chose", () => {
    expect(isAutoTitle({ title: "OAuth plan", firstUserMessage: first, agentId: AGENT })).toBe(false);
    expect(isAutoTitle({ title: "Chief", firstUserMessage: first, agentId: AGENT })).toBe(false);
  });

  it("does not treat a very short title as a prefix", () => {
    expect(isAutoTitle({ title: "Riy", firstUserMessage: first, agentId: AGENT })).toBe(false);
  });

  it("is false when the first message is gone and the title is not an id", () => {
    expect(isAutoTitle({ title: "Riyajul asking me", firstUserMessage: null, agentId: AGENT })).toBe(false);
  });
});

describe("pickAutoRename", () => {
  const base = {
    enabled: true,
    card: { title: "Google OAuth secret for Riajul", renamed: undefined },
    currentTitle: "Riyajul asking me this. Do we have it?",
    firstUserMessage: "Riyajul asking me this. Do we have it?",
    agentId: AGENT,
  };

  it("renames an automatic title to the theme", () => {
    expect(pickAutoRename(base)).toEqual({
      from: "Riyajul asking me this. Do we have it?",
      to: "Google OAuth secret for Riajul",
    });
  });

  it("never touches a title that was set by hand", () => {
    expect(pickAutoRename({ ...base, currentTitle: "Riajul OAuth" })).toBeNull();
  });

  it("renames once: a card that already carries the record is left alone", () => {
    expect(
      pickAutoRename({ ...base, card: { ...base.card, renamed: { from: null, to: "x", at: "y" } } }),
    ).toBeNull();
  });

  it("does nothing when disabled, without a theme, or when the title already is the theme", () => {
    expect(pickAutoRename({ ...base, enabled: false })).toBeNull();
    expect(pickAutoRename({ ...base, card: { title: "  ", renamed: undefined } })).toBeNull();
    expect(pickAutoRename({ ...base, card: { title: undefined, renamed: undefined } })).toBeNull();
    expect(pickAutoRename({ ...base, currentTitle: "Google OAuth secret for Riajul" })).toBeNull();
  });

  it("renames an untitled session (from null)", () => {
    expect(pickAutoRename({ ...base, currentTitle: null })).toEqual({
      from: null,
      to: "Google OAuth secret for Riajul",
    });
  });
});

describe("cleanThemeTitle", () => {
  it("collapses space, drops trailing punctuation and clamps to 50", () => {
    expect(cleanThemeTitle("  Model   picker struggles. ")).toBe("Model picker struggles");
    expect(cleanThemeTitle("x".repeat(80))).toHaveLength(50);
    expect(cleanThemeTitle("  ")).toBeNull();
    expect(cleanThemeTitle(undefined)).toBeNull();
  });
});

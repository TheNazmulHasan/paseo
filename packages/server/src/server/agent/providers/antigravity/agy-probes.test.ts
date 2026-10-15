import { describe, expect, it } from "vitest";

import {
  detectQuotaExhausted,
  familyRemaining,
  modelFamilyOf,
  parseModels,
  parseResetDurationMs,
  parseUsage,
  probeModels,
  probeUsage,
} from "./agy-probes.js";

const USAGE = [
  "Gemini Models\tWeekly Limit Remaining\t83%\t2026-10-11T10:03:59Z",
  "Gemini Models\tFive Hour Limit Remaining\t0%\t2026-10-04T15:07:46Z",
  "Claude and GPT models\tWeekly Limit Remaining\t46%\t2026-10-10T12:45:30Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-04T14:47:50Z",
].join("\n");

describe("parseUsage", () => {
  it("reads both families and both windows", () => {
    const usage = parseUsage(USAGE)!;
    expect(usage.gemini.weekly).toEqual({ remainingPercent: 83, resetsAt: "2026-10-11T10:03:59Z" });
    expect(usage.gemini.fiveHour?.remainingPercent).toBe(0);
    expect(usage["claude-gpt"].weekly?.remainingPercent).toBe(46);
    expect(usage["claude-gpt"].fiveHour?.remainingPercent).toBe(100);
  });

  it("returns null when nothing is recognisable", () => {
    expect(parseUsage("Fetching...\nsomething else")).toBeNull();
  });

  it("remaining is the lower of the 5-hour and weekly windows", () => {
    const usage = parseUsage(USAGE)!;
    expect(familyRemaining(usage, "gemini")).toBe(0);
    expect(familyRemaining(usage, "claude-gpt")).toBe(46);
  });

  it("returns null remaining for a family agy did not report", () => {
    const usage = parseUsage(
      "Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-04T14:47:39Z",
    )!;
    expect(familyRemaining(usage, "claude-gpt")).toBeNull();
  });
});

describe("parseModels", () => {
  it("skips the Fetching line and non-tab lines, keeps id and label", () => {
    const models = parseModels(
      [
        "Fetching available models...",
        "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
        "claude-opus-5-5-low\tClaude Opus 5.5 (Low)",
        "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
        "",
      ].join("\n"),
    );
    expect(models).toEqual([
      { agyId: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
      { agyId: "claude-opus-5-5-low", label: "Claude Opus 5.5 (Low)" },
    ]);
  });
});

describe("modelFamilyOf", () => {
  it.each([
    ["Gemini 3.1 Pro (High)", "gemini"],
    ["Gemini 3.8 Flash (Medium)", "gemini"],
    ["Claude Opus 5.5 (Low)", "claude-gpt"],
    ["Claude Sonnet 4.6 (Thinking)", "claude-gpt"],
    ["GPT-OSS 120B (Medium)", "claude-gpt"],
    ["claude-sonnet-5-5-high", "claude-gpt"],
    ["gemini-3.1-pro-low", "gemini"],
  ])("%s -> %s", (model, family) => {
    expect(modelFamilyOf(model)).toBe(family);
  });
});

describe("detectQuotaExhausted", () => {
  const ERR =
    "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 21h19m2s.";

  it("detects a failed turn and parses the reset time", () => {
    const result = detectQuotaExhausted({ stdout: "", stderr: ERR, code: 1, responseText: "" });
    expect(result.exhausted).toBe(true);
    expect(result.resetsInMs).toBe(((21 * 60 + 19) * 60 + 2) * 1000);
  });

  it("detects the error printed as the whole response with exit code 0", () => {
    expect(
      detectQuotaExhausted({ stdout: ERR, stderr: "", code: 0, responseText: ERR }).exhausted,
    ).toBe(true);
  });

  it("ignores a normal answer that merely mentions quotas", () => {
    const answer = "To handle RESOURCE_EXHAUSTED errors, back off and retry. ".repeat(20);
    expect(
      detectQuotaExhausted({ stdout: answer, stderr: "", code: 0, responseText: answer }).exhausted,
    ).toBe(false);
  });

  it("is false when nothing quota-like was printed", () => {
    expect(
      detectQuotaExhausted({ stdout: "", stderr: "boom", code: 1, responseText: "" }).exhausted,
    ).toBe(false);
  });

  it("parses durations in days, hours, minutes and seconds", () => {
    expect(parseResetDurationMs("Resets in 2d 3h")).toBe((2 * 24 + 3) * 3_600_000);
    expect(parseResetDurationMs("Resets in 45s")).toBe(45_000);
    expect(parseResetDurationMs("no duration")).toBeNull();
  });
});

describe("probes", () => {
  it("probeUsage falls back to stderr (agy mirrors output to both streams)", async () => {
    const usage = await probeUsage(async () => ({ stdout: "", stderr: USAGE, code: 0 }), {
      home: "/h",
      timeoutMs: 1,
    });
    expect(usage.gemini.weekly?.remainingPercent).toBe(83);
  });

  it("probeModels rejects when agy prints no models", async () => {
    await expect(
      probeModels(async () => ({ stdout: "", stderr: "Fetching available models...", code: 0 }), {
        home: "/h",
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/no models/);
  });
});

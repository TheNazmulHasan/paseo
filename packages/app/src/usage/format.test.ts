import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatAmount,
  formatCountdownClock,
  formatPreciseDuration,
  formatResetLabel,
  relativeDuration,
} from "./format";

describe("relativeDuration", () => {
  const baseTime = new Date("2026-10-20T12:00:00.000Z").getTime();

  it("returns null for invalid dates", () => {
    expect(relativeDuration("not-a-date", baseTime)).toBeNull();
  });

  it("returns 'now' when target is now or in the past", () => {
    expect(relativeDuration("2026-10-20T12:00:00.000Z", baseTime)).toBe("now");
    expect(relativeDuration("2026-10-20T11:59:00.000Z", baseTime)).toBe("now");
  });

  it("returns '<1m' when less than a minute in the future", () => {
    const in30s = new Date(baseTime + 30_000).toISOString();
    expect(relativeDuration(in30s, baseTime)).toBe("<1m");
  });

  it("returns minutes only when under 1 hour in the future", () => {
    const in5m = new Date(baseTime + 5 * 60_000).toISOString();
    const in45m = new Date(baseTime + 45 * 60_000).toISOString();
    expect(relativeDuration(in5m, baseTime)).toBe("5m");
    expect(relativeDuration(in45m, baseTime)).toBe("45m");
  });

  it("returns hours and minutes when under 24 hours in the future", () => {
    const in5h30m = new Date(baseTime + (5 * 60 + 30) * 60_000).toISOString();
    const in1h15m = new Date(baseTime + (1 * 60 + 15) * 60_000).toISOString();
    const in23h59m = new Date(baseTime + (23 * 60 + 59) * 60_000).toISOString();
    expect(relativeDuration(in5h30m, baseTime)).toBe("5h30m");
    expect(relativeDuration(in1h15m, baseTime)).toBe("1h15m");
    expect(relativeDuration(in23h59m, baseTime)).toBe("23h59m");
  });

  it("returns hours only when exactly on the hour under 24 hours", () => {
    const in5h = new Date(baseTime + 5 * 3600_000).toISOString();
    const in1h = new Date(baseTime + 1 * 3600_000).toISOString();
    expect(relativeDuration(in5h, baseTime)).toBe("5h");
    expect(relativeDuration(in1h, baseTime)).toBe("1h");
  });

  it("returns days and hours when 24 hours or more in the future", () => {
    const in1d5h = new Date(baseTime + (24 + 5) * 3600_000).toISOString();
    const in7d14h = new Date(baseTime + (7 * 24 + 14) * 3600_000).toISOString();
    expect(relativeDuration(in1d5h, baseTime)).toBe("1d5h");
    expect(relativeDuration(in7d14h, baseTime)).toBe("7d14h");
  });

  it("returns days only when exactly on the day threshold", () => {
    const in1d = new Date(baseTime + 24 * 3600_000).toISOString();
    const in7d = new Date(baseTime + 7 * 24 * 3600_000).toISOString();
    expect(relativeDuration(in1d, baseTime)).toBe("1d");
    expect(relativeDuration(in7d, baseTime)).toBe("7d");
  });
});

describe("formatPreciseDuration", () => {
  it("counts down in seconds under a minute and never shows 0s while time is left", () => {
    expect(formatPreciseDuration(40_000)).toBe("40s");
    expect(formatPreciseDuration(200)).toBe("1s");
    expect(formatPreciseDuration(0)).toBe("0s");
    expect(formatPreciseDuration(-5_000)).toBe("0s");
  });

  it("pairs minutes with seconds, hours with minutes, days with hours", () => {
    expect(formatPreciseDuration(220_000)).toBe("3m40s");
    expect(formatPreciseDuration(219_001)).toBe("3m40s");
    expect(formatPreciseDuration(4 * 60_000)).toBe("4m");
    expect(formatPreciseDuration((5 * 60 + 30) * 60_000)).toBe("5h30m");
    expect(formatPreciseDuration(58 * 60_000)).toBe("58m");
    expect(formatPreciseDuration((29 * 60 + 5) * 60_000)).toBe("1d5h");
  });
});

describe("formatCountdownClock", () => {
  it("reads as minutes and seconds, rounding seconds up", () => {
    expect(formatCountdownClock(220_000)).toBe("3:40");
    expect(formatCountdownClock(9_200)).toBe("0:10");
    expect(formatCountdownClock(58 * 60_000)).toBe("58:00");
    expect(formatCountdownClock(60 * 60_000)).toBe("60:00");
    expect(formatCountdownClock(0)).toBe("0:00");
    expect(formatCountdownClock(-1)).toBe("0:00");
  });
});

describe("formatResetLabel", () => {
  const baseTime = new Date("2026-10-20T12:00:00.000Z").getTime();

  it("returns null for null, undefined, or invalid inputs", () => {
    expect(formatResetLabel(null, baseTime)).toBeNull();
    expect(formatResetLabel(undefined, baseTime)).toBeNull();
    expect(formatResetLabel("invalid", baseTime)).toBeNull();
  });

  it("formats immediate or past resets as 'resetting now'", () => {
    expect(formatResetLabel("2026-10-20T12:00:00.000Z", baseTime)).toBe("resetting now");
    expect(formatResetLabel("2026-10-20T11:00:00.000Z", baseTime)).toBe("resetting now");
  });

  it("formats precise dynamic durations", () => {
    const in1d5h = new Date(baseTime + 29 * 3600_000).toISOString();
    const in5h30m = new Date(baseTime + (5 * 60 + 30) * 60_000).toISOString();
    const in45m = new Date(baseTime + 45 * 60_000).toISOString();
    const in30s = new Date(baseTime + 30_000).toISOString();

    expect(formatResetLabel(in1d5h, baseTime)).toBe("resets 1d5h");
    expect(formatResetLabel(in5h30m, baseTime)).toBe("resets 5h30m");
    expect(formatResetLabel(in45m, baseTime)).toBe("resets 45m");
    expect(formatResetLabel(in30s, baseTime)).toBe("resets <1m");
  });
});

describe("formatAgo", () => {
  const baseTime = new Date("2026-10-20T12:00:00.000Z").getTime();

  it("returns null for null or invalid inputs", () => {
    expect(formatAgo(null, baseTime)).toBeNull();
    expect(formatAgo("invalid", baseTime)).toBeNull();
  });

  it("formats recent durations", () => {
    const justNow = new Date(baseTime - 30_000).toISOString();
    const m5Ago = new Date(baseTime - 5 * 60_000).toISOString();
    const h2Ago = new Date(baseTime - 2 * 3600_000).toISOString();
    const d3Ago = new Date(baseTime - 3 * 24 * 3600_000).toISOString();

    expect(formatAgo(justNow, baseTime)).toBe("just now");
    expect(formatAgo(m5Ago, baseTime)).toBe("5m ago");
    expect(formatAgo(h2Ago, baseTime)).toBe("2h ago");
    expect(formatAgo(d3Ago, baseTime)).toBe("3d ago");
  });
});

describe("formatAmount", () => {
  it("groups thousands in the app's language", () => {
    expect(formatAmount(12345, "credits", "en")).toBe("12,345");
    expect(formatAmount(12345, "requests", "en")).toBe("12,345");
    expect(formatAmount(12345, "credits", "fr").replace(/\s/g, " ")).toBe("12 345");
  });

  it("formats dollars as the language writes currency", () => {
    expect(formatAmount(1234.5, "usd", "en")).toBe("$1,234.50");
    expect(formatAmount(1234.5, "usd", "fr").replace(/\s/g, " ")).toBe("1 234,50 $US");
  });
});

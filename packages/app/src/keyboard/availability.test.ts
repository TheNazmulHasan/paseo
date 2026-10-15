import { describe, expect, it } from "vitest";
import { keyboardShortcutsAvailable } from "./availability";

describe("keyboardShortcutsAvailable", () => {
  it("matches the environments where the shortcut dispatcher runs", () => {
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: false })).toBe(true);
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: true })).toBe(false);
    expect(keyboardShortcutsAvailable({ isNative: true, isCompact: false })).toBe(false);
    expect(keyboardShortcutsAvailable({ isNative: true, isCompact: true })).toBe(false);
  });

  it("keeps the keyboard alive in a narrow desktop window", () => {
    // Paseo squeezed beside another app is under the sm breakpoint, exactly like a
    // phone. It still has a keyboard, and it is the layout where shortcuts matter
    // most, so every shortcut used to die precisely where it was needed.
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: true, isDesktop: true })).toBe(
      true,
    );
    expect(keyboardShortcutsAvailable({ isNative: false, isCompact: false, isDesktop: true })).toBe(
      true,
    );
  });

  it("still trusts width on native, where compact really can mean no keyboard", () => {
    expect(keyboardShortcutsAvailable({ isNative: true, isCompact: true, isDesktop: true })).toBe(
      false,
    );
  });
});

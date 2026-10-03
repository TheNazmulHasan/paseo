import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import {
  applyPlaceSidebarsPatch,
  getPlaceSidebars,
  migratePlaceSidebarsState,
  rememberPlaceSidebars,
  resolvePlaceKeyFromPathname,
  resolvePlaceLeftSidebarStep,
  usePlaceSidebarsStore,
} from "@/stores/place-sidebars-store";

describe("place sidebars store", () => {
  beforeEach(() => {
    usePlaceSidebarsStore.setState({ byPlace: {} });
  });

  it("remembers each place separately and merges patches", () => {
    rememberPlaceSidebars("s:a", { left: true });
    rememberPlaceSidebars("board:v", { left: false });
    rememberPlaceSidebars("s:a", { right: true });
    expect(getPlaceSidebars("s:a")).toEqual({ left: true, right: true });
    expect(getPlaceSidebars("board:v")).toEqual({ left: false });
    expect(getPlaceSidebars("s:none")).toBeUndefined();
  });

  it("returns the same object when nothing changes", () => {
    const first = applyPlaceSidebarsPatch({}, "a", { left: true });
    expect(applyPlaceSidebarsPatch(first, "a", { left: true })).toBe(first);
  });

  it("caps entries and drops the oldest", () => {
    let byPlace: Record<string, { left?: boolean }> = {};
    for (let i = 0; i < 5; i += 1)
      byPlace = applyPlaceSidebarsPatch(byPlace, `p${i}`, { left: true }, 3);
    expect(Object.keys(byPlace)).toEqual(["p2", "p3", "p4"]);
    byPlace = applyPlaceSidebarsPatch(byPlace, "p2", { left: false }, 3);
    byPlace = applyPlaceSidebarsPatch(byPlace, "p5", { left: true }, 3);
    expect(Object.keys(byPlace)).toEqual(["p4", "p2", "p5"]);
  });

  it("migrates junk to an empty map and keeps valid data", () => {
    expect(migratePlaceSidebarsState({ byPlace: "nope" })).toEqual({ byPlace: {} });
    expect(migratePlaceSidebarsState({ byPlace: { a: { left: "x" } } })).toEqual({ byPlace: {} });
    expect(migratePlaceSidebarsState(undefined)).toEqual({ byPlace: {} });
    expect(migratePlaceSidebarsState({ byPlace: { a: { left: false } } })).toEqual({
      byPlace: { a: { left: false } },
    });
  });
});

describe("resolvePlaceKeyFromPathname", () => {
  it("derives workspace and view keys", () => {
    expect(resolvePlaceKeyFromPathname("/h/srv/workspace/ws1")).toBe("srv:ws1");
    expect(resolvePlaceKeyFromPathname("/boards/abc")).toBe("board:abc");
    expect(resolvePlaceKeyFromPathname("/settings")).toBeNull();
  });
});

describe("resolvePlaceLeftSidebarStep", () => {
  it("applies the stored value when arriving at a place that differs", () => {
    expect(
      resolvePlaceLeftSidebarStep({ placeChanged: true, stored: true, current: false }),
    ).toEqual({
      type: "apply",
      open: true,
    });
  });
  it("does nothing on arrival when the stored value already matches", () => {
    expect(
      resolvePlaceLeftSidebarStep({ placeChanged: true, stored: false, current: false }),
    ).toEqual({
      type: "none",
    });
  });
  it("keeps the sidebar and stores it when the place has nothing stored", () => {
    expect(
      resolvePlaceLeftSidebarStep({ placeChanged: true, stored: undefined, current: true }),
    ).toEqual({ type: "remember", open: true });
  });
  it("stores a toggle for the current place", () => {
    expect(
      resolvePlaceLeftSidebarStep({ placeChanged: false, stored: true, current: false }),
    ).toEqual({
      type: "remember",
      open: false,
    });
    expect(
      resolvePlaceLeftSidebarStep({ placeChanged: false, stored: false, current: false }),
    ).toEqual({
      type: "none",
    });
  });
});

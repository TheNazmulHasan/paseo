import { beforeEach, describe, expect, it } from "vitest";
import { resolveArrangeViewport, useArrangeViewportStore } from "@/arrange/viewport";

describe("arrange viewport", () => {
  beforeEach(() => {
    useArrangeViewportStore.setState({ byWorkspace: {} });
  });

  it("prefers the measured split area", () => {
    expect(
      resolveArrangeViewport({
        measured: { width: 900, height: 600 },
        windowSize: { width: 1400, height: 900 },
        explorerWidth: 300,
      }),
    ).toEqual({ width: 900, height: 600 });
  });

  it("falls back to the window minus the explorer width", () => {
    expect(
      resolveArrangeViewport({
        measured: null,
        windowSize: { width: 1400, height: 900 },
        explorerWidth: 300,
      }),
    ).toEqual({ width: 1100, height: 900 });
  });

  it("ignores empty measurements and sub-pixel jitter", () => {
    const { report } = useArrangeViewportStore.getState();
    report("ws", { width: 0, height: 500 });
    expect(useArrangeViewportStore.getState().byWorkspace.ws).toBeUndefined();
    report("ws", { width: 800, height: 500 });
    const first = useArrangeViewportStore.getState().byWorkspace;
    report("ws", { width: 800.4, height: 500 });
    expect(useArrangeViewportStore.getState().byWorkspace).toBe(first);
    report("ws", { width: 820, height: 500 });
    expect(useArrangeViewportStore.getState().byWorkspace.ws).toEqual({ width: 820, height: 500 });
  });
});

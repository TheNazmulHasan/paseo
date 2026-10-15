import { useCallback } from "react";
import type { LayoutChangeEvent } from "react-native";
import { create } from "zustand";
import type { ArrangeViewport } from "@/arrange/types";

/**
 * The measured pixel size of a workspace's split area (the main column, so the Explorer dock is
 * excluded). SplitContainer writes it from its outer onLayout; the workspace screen reads it when
 * an arrange action fires. Per workspace key, session-only.
 */
interface ArrangeViewportStoreState {
  byWorkspace: Record<string, ArrangeViewport>;
  report: (workspaceKey: string, viewport: ArrangeViewport) => void;
}

const MIN_CHANGE_PX = 1;

export const useArrangeViewportStore = create<ArrangeViewportStoreState>()((set, get) => ({
  byWorkspace: {},
  report: (workspaceKey, viewport) => {
    if (!(viewport.width > 0) || !(viewport.height > 0)) {
      return;
    }
    const current = get().byWorkspace[workspaceKey];
    if (
      current &&
      Math.abs(current.width - viewport.width) < MIN_CHANGE_PX &&
      Math.abs(current.height - viewport.height) < MIN_CHANGE_PX
    ) {
      return;
    }
    set({ byWorkspace: { ...get().byWorkspace, [workspaceKey]: viewport } });
  },
}));

/** Stable onLayout handler for the split container's outer view. */
export function useArrangeViewportReporter(
  workspaceKey: string,
): (event: LayoutChangeEvent) => void {
  return useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      useArrangeViewportStore.getState().report(workspaceKey, { width, height });
    },
    [workspaceKey],
  );
}

/**
 * The size to lay out into: the measured split area, or, before the first layout pass, the
 * window minus the Explorer dock. Never null, so an arrange shortcut always has something to use.
 */
export function resolveArrangeViewport(input: {
  measured: ArrangeViewport | null | undefined;
  windowSize: ArrangeViewport;
  explorerWidth: number;
}): ArrangeViewport {
  if (input.measured && input.measured.width > 0 && input.measured.height > 0) {
    return input.measured;
  }
  return {
    width: Math.max(0, input.windowSize.width - Math.max(0, input.explorerWidth)),
    height: input.windowSize.height,
  };
}

export function useMeasuredArrangeViewport(workspaceKey: string | null): ArrangeViewport | null {
  return useArrangeViewportStore((state) =>
    workspaceKey ? (state.byWorkspace[workspaceKey] ?? null) : null,
  );
}

/**
 * Arrange: keyboard-driven layouts for a workspace's sessions (fork mod #11).
 * One folder on purpose, so upstream merges touch as few shared files as possible.
 */

/** A layout preset. "watch" is not a preset: it is grid over the agents that are working. */
export type ArrangePreset = "single" | "columns-2" | "columns-3" | "grid";

/** The pixel size of the split area the layout will fill (Explorer dock excluded). */
export interface ArrangeViewport {
  width: number;
  height: number;
}

export interface NamedLayoutSummary {
  id: string;
  name: string;
  savedAt: number;
}

/**
 * What the user picked. `tabIds` are open tabs (Cmd/Shift-click in a tab strip);
 * `agentIds` are sidebar picks that may not be open as tabs yet — applying a
 * layout opens them first. Empty selection means "every session".
 */
export interface ArrangeSelection {
  tabIds: readonly string[];
  agentIds: readonly string[];
}

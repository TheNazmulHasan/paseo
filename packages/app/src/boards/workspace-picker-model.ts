import type { ArrangeViewport } from "@/arrange/types";
import { resolveArrangeViewport } from "@/arrange/viewport";

export type SplitLayoutChoice = "columns" | "grid";

/** One workspace the split picker can offer. `key` is `serverId:workspaceId`. */
export interface PickerWorkspace {
  key: string;
  serverId: string;
  workspaceId: string;
  title: string;
  projectName: string;
  projectViewKey: string;
  initial: string;
  iconDataUri: string | null;
}

/** A split needs at least two workspaces; one is just the workspace. */
export const MIN_SPLIT_WORKSPACES = 2;

/** The sidebar's width, taken off the window when the workspace has not reported its own size. */
const SIDEBAR_ALLOWANCE_PX = 320;

/**
 * The current workspace first (it is what the user is looking at and starts checked), then the
 * Desk in its own order, then the rest in the order given.
 */
export function orderPickerWorkspaces<T extends { key: string }>(
  items: readonly T[],
  input: { currentKey: string | null; deskKeys: ReadonlySet<string> },
): T[] {
  const { currentKey, deskKeys } = input;
  const current = items.filter((item) => item.key === currentKey);
  const rest = items.filter((item) => item.key !== currentKey);
  return [
    ...current,
    ...rest.filter((item) => deskKeys.has(item.key)),
    ...rest.filter((item) => !deskKeys.has(item.key)),
  ];
}

/** Every word of the query must appear in the workspace name or its project name. */
export function filterPickerWorkspaces<T extends { title: string; projectName: string }>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const haystack = `${item.title} ${item.projectName}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Checked keys in the order they were checked: the split follows that order. */
export function togglePickedKey(picked: readonly string[], key: string): string[] {
  return picked.includes(key) ? picked.filter((entry) => entry !== key) : [...picked, key];
}

export function canSplit(picked: readonly string[]): boolean {
  return picked.length >= MIN_SPLIT_WORKSPACES;
}

/** Enter = Columns, Shift+Enter = Grid. */
export function layoutForEnter(shiftKey: boolean): SplitLayoutChoice {
  return shiftKey ? "grid" : "columns";
}

/** Keeps the highlighted row inside the visible list as it is filtered or moved. */
export function moveHighlight(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}

/** The workspace's measured split area, else the window minus the sidebar. */
export function resolveSplitViewport(input: {
  measured: ArrangeViewport | null | undefined;
  windowSize: ArrangeViewport;
}): ArrangeViewport {
  return resolveArrangeViewport({
    measured: input.measured,
    windowSize: input.windowSize,
    explorerWidth: SIDEBAR_ALLOWANCE_PX,
  });
}

/** Add mode: toggling a workspace already in the view does nothing (it stays checked). */
export function togglePickedKeyUnlessLocked(
  picked: readonly string[],
  key: string,
  locked: ReadonlySet<string>,
): string[] {
  return locked.has(key) ? [...picked] : togglePickedKey(picked, key);
}

/** Add mode: the checked workspaces that are new to the view, in the order they were checked. */
export function newPickedKeys(picked: readonly string[], locked: ReadonlySet<string>): string[] {
  return picked.filter((key) => !locked.has(key));
}

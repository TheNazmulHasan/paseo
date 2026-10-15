import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { ShortcutOs } from "@/utils/format-shortcut";

/** Only the modifier flags of a mouse/pointer/responder event; real DOM events satisfy it. */
export interface SelectionModifierEvent {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export type SelectionGesture = "toggle" | "range";

/** Cmd on mac, Ctrl elsewhere. Ctrl-click on mac is the context-menu click, so it never selects. */
export function isSelectionModifier(event: SelectionModifierEvent, platform: ShortcutOs): boolean {
  return platform === "mac" ? event.metaKey === true : event.ctrlKey === true;
}

/** Cmd/Ctrl-click toggles; Shift-click (no Cmd/Ctrl) extends a range; anything else is a plain click. */
export function resolveSelectionGesture(
  event: SelectionModifierEvent,
  platform: ShortcutOs,
  allowRange: boolean,
): SelectionGesture | null {
  if (isSelectionModifier(event, platform)) {
    return "toggle";
  }
  if (allowRange && event.shiftKey === true && !event.metaKey && !event.ctrlKey) {
    return "range";
  }
  return null;
}

/**
 * Tab ids in the order they appear across panes: left-to-right, top-to-bottom, which is the
 * layout tree's depth-first order. Hidden panes (collapsed Explorer dock) are left out unless
 * `includeHidden`, because their tabs cannot be range-selected from a strip.
 */
export function orderedWorkspaceTabIds(
  layout: WorkspaceLayout,
  options: { includeHidden?: boolean } = {},
): string[] {
  const includeHidden = options.includeHidden === true;
  const ids: string[] = [];
  const visit = (node: SplitNode) => {
    if (node.kind === "pane") {
      if (includeHidden || node.pane.hidden !== true) {
        ids.push(...node.pane.tabIds);
      }
      return;
    }
    for (const child of node.group.children) {
      visit(child);
    }
  };
  visit(layout.root);
  return ids;
}

/** Selected tab ids whose tab no longer exists in the layout. */
export function staleSelectedTabIds(
  selectedTabIds: readonly string[],
  layout: WorkspaceLayout,
): string[] {
  const live = new Set(orderedWorkspaceTabIds(layout, { includeHidden: true }));
  return selectedTabIds.filter((tabId) => !live.has(tabId));
}

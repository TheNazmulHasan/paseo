import { useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import { isNative } from "@/constants/platform";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  resolveSelectionGesture,
  staleSelectedTabIds,
  type SelectionGesture,
} from "@/arrange/selection-helpers";
import { getArrangeSelection, useArrangeSelectionStore } from "@/arrange/selection-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { getShortcutOs } from "@/utils/shortcut-platform";

interface SelectionPointerGestureInput {
  /** Shift-click ranges. Off for rows that only toggle (sidebar). */
  allowRange: boolean;
  /** Skip clicks that land on a nested control, e.g. a tab's close button. */
  shouldIgnoreTarget?: (target: EventTarget | null) => boolean;
  onGesture: (gesture: SelectionGesture) => void;
}

/**
 * Cmd/Ctrl-click and Shift-click on a web element, handled before anything below it sees the press.
 *
 * Why a DOM capture listener and not Pressable's onPress: react-native-web's press events cannot
 * tell Ctrl (it hardcodes ctrlKey false on onPressIn) and a Pressable that navigates on press-in
 * would activate the tab before onPress ever fires. Stopping the gesture at the wrapper also keeps
 * the drag sensor from starting. Plain clicks never match, so they behave exactly as before.
 */
export function useSelectionPointerGesture(
  ref: RefObject<View | null>,
  input: SelectionPointerGestureInput,
) {
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    if (isNative) {
      return;
    }
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) {
      return;
    }

    function resolve(event: MouseEvent): SelectionGesture | null {
      const current = inputRef.current;
      if (event.button !== 0 || current.shouldIgnoreTarget?.(event.target)) {
        return null;
      }
      return resolveSelectionGesture(event, getShortcutOs(), current.allowRange);
    }

    function handlePointerDown(event: PointerEvent) {
      const gesture = resolve(event);
      if (!gesture) {
        return;
      }
      // preventDefault also cancels the compat mousedown, and keeps focus and text selection put.
      event.preventDefault();
      event.stopPropagation();
      inputRef.current.onGesture(gesture);
    }

    function swallowFollowUp(event: MouseEvent) {
      if (resolve(event)) {
        event.stopPropagation();
      }
    }

    node.addEventListener("pointerdown", handlePointerDown, true);
    node.addEventListener("mousedown", swallowFollowUp, true);
    node.addEventListener("click", swallowFollowUp, true);
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown, true);
      node.removeEventListener("mousedown", swallowFollowUp, true);
      node.removeEventListener("click", swallowFollowUp, true);
    };
  }, [ref]);
}

// Above the composer's own Escape handler (100, or 200 while the input is focused): a pending
// selection is the thing Escape should dismiss, not a running agent.
const ESCAPE_CLEAR_PRIORITY = 250;

/**
 * Escape clears this workspace's arrange selection, and only when there is one — with none, the
 * handler declines and Escape keeps interrupting the agent as before. Also drops selected tab ids
 * whose tab has since closed. Idempotent, so every pane's tab strip may mount it.
 */
export function useArrangeSelectionLifecycle(input: {
  workspaceKey: string | null;
  handlerId: string;
  enabled: boolean;
}) {
  const { workspaceKey } = input;

  useKeyboardActionHandler({
    handlerId: input.handlerId,
    actions: ["agent.interrupt"],
    enabled: input.enabled && workspaceKey !== null,
    priority: ESCAPE_CLEAR_PRIORITY,
    handle: (action: KeyboardActionDefinition) => {
      if (action.id !== "agent.interrupt" || !workspaceKey) {
        return false;
      }
      const selection = getArrangeSelection(workspaceKey);
      if (selection.tabIds.length === 0 && selection.agentIds.length === 0) {
        return false;
      }
      useArrangeSelectionStore.getState().clear(workspaceKey);
      return true;
    },
  });

  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const selectedTabIds = useArrangeSelectionStore((state) =>
    workspaceKey ? state.byWorkspace[workspaceKey]?.tabIds : undefined,
  );
  useEffect(() => {
    if (!workspaceKey || !layout || !selectedTabIds || selectedTabIds.length === 0) {
      return;
    }
    const { toggleTab } = useArrangeSelectionStore.getState();
    for (const tabId of staleSelectedTabIds(selectedTabIds, layout)) {
      toggleTab(workspaceKey, tabId);
    }
  }, [layout, selectedTabIds, workspaceKey]);
}

import { useCallback, useEffect, useRef } from "react";
import { useLiveBoardSync } from "@/boards/controller";
import { openSplitPicker } from "@/boards/split-picker-store";
import { WorkspacePicker } from "@/boards/workspace-picker";
import { useBoardsCommandCenterActions } from "@/command-center/boards-registration";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";

const SPLIT_ACTIONS: readonly KeyboardActionId[] = ["workspace.board.split"];

/**
 * Everything Boards needs mounted once at app level (fork mod #13): the Live view keeps itself in
 * step with running agents, Ctrl+Cmd+V and the Command Center open the split picker, and the
 * Command Center lists the views. One element in the root layout instead of four.
 */
export function BoardsHost() {
  useLiveBoardSync();
  useBoardsCommandCenterActions();
  const openFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
      }
    },
    [],
  );

  // The command center closes and dispatches in the same React batch, so opening synchronously
  // would mount the dialog while the palette is still unmounting (it steals focus back). Wait a
  // frame, as the workspace rename host does.
  const handle = useCallback(() => {
    if (openFrameRef.current !== null) {
      cancelAnimationFrame(openFrameRef.current);
    }
    openFrameRef.current = requestAnimationFrame(() => {
      openFrameRef.current = null;
      openSplitPicker();
    });
    return true;
  }, []);

  useKeyboardActionHandler({
    handlerId: "workspace-board-split-global",
    actions: SPLIT_ACTIONS,
    enabled: true,
    priority: 0,
    handle,
  });

  return <WorkspacePicker />;
}

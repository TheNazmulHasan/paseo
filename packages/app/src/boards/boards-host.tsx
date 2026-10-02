import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { rememberNonBoardPathname } from "@/boards/back-store";
import { useLiveBoardSync } from "@/boards/controller";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { goBackFromBoard } from "@/boards/navigation";
import { openSplitPicker } from "@/boards/split-picker-store";
import { WorkspacePicker } from "@/boards/workspace-picker";
import { useBoardsCommandCenterActions } from "@/command-center/boards-registration";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";

const SPLIT_ACTIONS: readonly KeyboardActionId[] = ["workspace.board.split"];

/**
 * Everything Boards needs mounted once at app level (fork mod #13): the Live view keeps itself in
 * step with running agents, Ctrl+Cmd+V and the Command Center open the split picker (on a view
 * the same key goes back to the workspace instead, Esc being the agents'), and the Command
 * Center lists the views. One element in the root layout instead of four.
 */
export function BoardsHost() {
  useLiveBoardSync();
  useBoardsCommandCenterActions();
  const pathname = usePathname();
  // Follow the route, so a view always knows where it came from.
  useEffect(() => {
    rememberNonBoardPathname(pathname);
  }, [pathname]);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
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
    // On a view the split key toggles: pressing it again returns to the normal workspace view.
    const boardId = parseBoardIdFromPathname(pathnameRef.current);
    if (boardId !== null && goBackFromBoard(boardId)) {
      return true;
    }
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

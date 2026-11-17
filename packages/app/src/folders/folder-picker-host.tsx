import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";
import { FolderPicker } from "@/folders/folder-picker";
import { openFolderPicker } from "@/folders/folder-picker-store";
import { hostOfItem } from "@/folders/actions";
import type { FolderItemRef } from "@/folders/model";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

const MOVE_ACTIONS: readonly KeyboardActionId[] = ["workspace.folder.move"];

function resolveOnScreenItem(input: {
  boardId: string | null;
  serverId: string | null;
  workspaceId: string | null;
}): FolderItemRef | null {
  if (input.boardId) {
    return { kind: "board", boardId: input.boardId };
  }
  if (input.serverId && input.workspaceId) {
    return { kind: "workspace", serverId: input.serverId, workspaceId: input.workspaceId };
  }
  return null;
}

/**
 * Mounted once at app level: the folder picker dialog, and Ctrl+Cmd+M, which opens it for what is
 * on screen, a view when the route is one, else the open workspace (route selection, the same
 * "active workspace" the Desk and pin keys use).
 */
export function FolderPickerHost() {
  const pathname = usePathname();
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const routeWorkspaceId = selection?.workspaceId ?? null;
  // The route carries an opaque id that need not equal the descriptor id folders are keyed on.
  const fields = useWorkspaceFields(serverId, routeWorkspaceId, (workspace) => ({
    id: workspace.id,
  }));
  const boardId = parseBoardIdFromPathname(pathname);
  const itemRef = useRef<FolderItemRef | null>(null);
  itemRef.current = resolveOnScreenItem({ boardId, serverId, workspaceId: fields?.id ?? null });
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // The command center closes and dispatches in the same React batch, so opening synchronously
  // would mount the dialog while the palette is still unmounting (it steals focus back).
  const handle = useCallback(() => {
    const item = itemRef.current;
    if (!item || !hostOfItem(item)) {
      return false;
    }
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      openFolderPicker(item);
    });
    return true;
  }, []);

  useKeyboardActionHandler({
    handlerId: "workspace-folder-move-global",
    actions: MOVE_ACTIONS,
    enabled: true,
    priority: 0,
    handle,
  });

  return <FolderPicker />;
}

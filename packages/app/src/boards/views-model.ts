import { LIVE_BOARD_ID, type BoardSummary } from "@/boards/types";

/** Live first, then the saved splits in the order given. */
export function orderViewRows(boards: readonly BoardSummary[]): BoardSummary[] {
  const live = boards.filter((board) => board.id === LIVE_BOARD_ID || board.kind === "live");
  const rest = boards.filter((board) => !(board.id === LIVE_BOARD_ID || board.kind === "live"));
  return [...live, ...rest];
}

/** Which row is on screen: the board id of a `/boards/<id>` pathname. */
export function isViewActive(activeBoardId: string | null, boardId: string): boolean {
  return activeBoardId !== null && activeBoardId === boardId;
}

/** A rename is only kept when it says something new. */
export function resolveRename(current: string, draft: string): string | null {
  const next = draft.trim();
  return next.length > 0 && next !== current ? next : null;
}

/** Rename and delete show always on the row on screen and only on hover elsewhere. */
export function showRowActions(input: {
  active: boolean;
  hovered: boolean;
  canHover: boolean;
}): boolean {
  return input.active || input.hovered || !input.canHover;
}

/**
 * One inline rename, from open to settled. Enter and clicking away both save, Escape cancels,
 * and whichever comes first wins: Enter blurs the input a moment later, and an unmounting input
 * can blur too, so a second event must never undo or repeat the first. Saving what is in the box
 * (even unchanged) is the caller's call; `resolveRename` decides whether it says anything new.
 */
export function createRenameSession(input: {
  initialValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  let draft = input.initialValue;
  let settled = false;
  const settle = (action: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    action();
  };
  return {
    change: (text: string) => {
      draft = text;
    },
    submit: () => settle(() => input.onCommit(draft)),
    blur: () => settle(() => input.onCommit(draft)),
    cancel: () => settle(input.onCancel),
  };
}

/**
 * The last route the user was on that is not a view, so "Back to workspace" can return to it.
 * Session-only on purpose: a restart opens on its own route and must not replay an old one.
 */
import { parseBoardIdFromPathname } from "@/boards/keyboard-contract";

let previousNonBoardPathname: string | null = null;

export function getPreviousNonBoardPathname(): string | null {
  return previousNonBoardPathname;
}

/** Records `pathname` unless it is empty or a view; returns whether it was recorded. */
export function rememberNonBoardPathname(pathname: string | null | undefined): boolean {
  if (!pathname || parseBoardIdFromPathname(pathname) !== null) {
    return false;
  }
  previousNonBoardPathname = pathname;
  return true;
}

export function resetPreviousNonBoardPathname(): void {
  previousNonBoardPathname = null;
}

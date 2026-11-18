// Home v2 (fork mod, home-map): which key does what. Pure, so the rule is tested and the web
// wiring in `use-home-keys.ts` stays a thin shell. Keys are web/desktop only.

export type HomeOverlay = "none" | "sweep" | "drawer";

export type HomeKeyAction =
  | { type: "focus"; index: number }
  | { type: "open" }
  | { type: "later" }
  | { type: "close" }
  | { type: "escape" }
  | { type: "sweep-keep" }
  | { type: "sweep-close" }
  | { type: "sweep-open" };

export interface HomeKeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** A text field has focus: every key belongs to it (Escape still leaves an overlay). */
  editing: boolean;
  /** A button or link has focus: Enter belongs to it, so it does not fire twice. */
  onControl: boolean;
  /** How many numbered queue items are on screen; 1-9 only reach these. */
  itemCount: number;
  /** The focused queue item (0-based), or null. */
  focusedIndex: number | null;
  /** The focused item has Later and Close (Chief's layout items only have Open). */
  focusedHasActions: boolean;
  /** A menu (Later) is open and owns the keyboard. */
  menuOpen: boolean;
  overlay: HomeOverlay;
}

function decideSweepKey(key: string, input: HomeKeyInput): HomeKeyAction | null {
  if (key === "k") return { type: "sweep-keep" };
  if (key === "c") return { type: "sweep-close" };
  if (key === "Enter" && !input.onControl) return { type: "sweep-open" };
  return null;
}

function decideQueueKey(key: string, input: HomeKeyInput): HomeKeyAction | null {
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < input.itemCount ? { type: "focus", index } : null;
  }
  if (input.focusedIndex === null) return null;
  if (key === "Enter" && !input.onControl) return { type: "open" };
  if (key === "l" && input.focusedHasActions) return { type: "later" };
  if (key === "c" && input.focusedHasActions) return { type: "close" };
  return null;
}

/**
 * - 1-9 focus that queue item, Enter opens the focused item, L opens its Later menu, C closes it.
 * - In Sweep: K keeps, C closes, Enter opens; Esc leaves. With the Chief drawer open: Esc closes it.
 * - Ignored while a text field has focus, a menu is open, or with Ctrl/Cmd/Alt held.
 */
export function decideHomeKey(input: HomeKeyInput): HomeKeyAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.key === "Escape") {
    return input.overlay === "none" ? null : { type: "escape" };
  }
  if (input.editing || input.menuOpen) return null;

  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (input.overlay === "drawer") return null;
  if (input.overlay === "sweep") return decideSweepKey(key, input);
  return decideQueueKey(key, input);
}

import {
  arrangeWorkspace,
  equalizeWorkspacePanes,
  restoreWorkspaceArrangement,
  toggleWatchMode,
} from "@/arrange/controller";
import type { ArrangePreset, ArrangeViewport } from "@/arrange/types";

/** The seven things the keyboard, the menu and the Command Center can ask Arrange to do. */
export type ArrangeCommand =
  | "single"
  | "columns2"
  | "columns3"
  | "grid"
  | "watch"
  | "restore"
  | "equalize";

const PRESET_BY_COMMAND: Partial<Record<ArrangeCommand, ArrangePreset>> = {
  single: "single",
  columns2: "columns-2",
  columns3: "columns-3",
  grid: "grid",
};

const ACTION_ID_PREFIX = "workspace.arrange.";

const COMMANDS: readonly ArrangeCommand[] = [
  "single",
  "columns2",
  "columns3",
  "grid",
  "watch",
  "restore",
  "equalize",
];

/** `workspace.arrange.grid` -> `grid`. Null for ids that are not an arrange command. */
export function arrangeCommandFromActionId(actionId: string): ArrangeCommand | null {
  if (!actionId.startsWith(ACTION_ID_PREFIX)) {
    return null;
  }
  const name = actionId.slice(ACTION_ID_PREFIX.length);
  return COMMANDS.find((command) => command === name) ?? null;
}

export function runArrangeCommand(
  command: ArrangeCommand,
  input: { workspaceKey: string; viewport: ArrangeViewport },
): boolean {
  const { workspaceKey, viewport } = input;
  const preset = PRESET_BY_COMMAND[command];
  if (preset) {
    return arrangeWorkspace({ workspaceKey, preset, viewport });
  }
  if (command === "watch") {
    return toggleWatchMode({ workspaceKey, viewport });
  }
  if (command === "restore") {
    return restoreWorkspaceArrangement(workspaceKey);
  }
  return equalizeWorkspacePanes(workspaceKey);
}

/**
 * While the Arrange menu is open these bare keys act on it. R is Restore, which is why this is not
 * the same map as the global chords (those use Z for Restore).
 */
const MENU_KEY_COMMANDS: Record<string, ArrangeCommand> = {
  "1": "single",
  "2": "columns2",
  "3": "columns3",
  g: "grid",
  w: "watch",
  r: "restore",
  e: "equalize",
};

export function resolveArrangeMenuKey(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): ArrangeCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  return MENU_KEY_COMMANDS[event.key.toLowerCase()] ?? null;
}

import type { AppActionInfo } from "@getpaseo/protocol/chief";
import type { CommandCenterContribution } from "@/command-center/contributions";
import type { KeyboardShortcutPayload, MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { DEFAULT_BINDINGS, type ParsedShortcutBinding } from "@/keyboard/keyboard-shortcuts";

/**
 * Nazmul mod (chief): the catalogue of what an agent can run in the app.
 *
 * Two kinds, one id space an agent can paste back into `run_action`:
 * - `keyboard:<action>`: a keyboard shortcut's action (the id the keybindings use, e.g.
 *   `workspace.pin`). Run through the same router the keyboard uses.
 * - `command:<id>`: a Command Center item, by the id it registered with.
 *
 * The list is asked of the live app, not generated at build time: Command Center items change
 * with the screen, the workspace and plugins, so a static list would offer ids that do not exist
 * and miss ids that do.
 */

export const KEYBOARD_PREFIX = "keyboard:";
export const COMMAND_PREFIX = "command:";

function argsHint(binding: ParsedShortcutBinding): string | undefined {
  switch (binding.payload?.type) {
    case "index":
      return "index: a number, 1 to 9";
    case "delta":
      return "delta: 1 or -1";
    case "message-input":
      return "kind: focus | send | dictation-toggle | dictation-cancel | dictation-confirm | voice-toggle | voice-mute-toggle | mode-cycle";
    default:
      return undefined;
  }
}

/** One row per keyboard action, labelled from its Keyboard shortcuts help row when it has one. */
export function listKeyboardActions(
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): AppActionInfo[] {
  const byAction = new Map<string, AppActionInfo>();
  for (const binding of bindings) {
    const existing = byAction.get(binding.action);
    const label = binding.help?.label;
    if (existing) {
      if (existing.label === binding.action && label) existing.label = label;
      continue;
    }
    byAction.set(binding.action, {
      id: `${KEYBOARD_PREFIX}${binding.action}`,
      kind: "keyboard",
      label: label ?? binding.action,
      ...(argsHint(binding) ? { args: argsHint(binding) } : {}),
    });
  }
  return [...byAction.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function commandLabel(item: CommandCenterContribution): string {
  return item.presentation.kind === "action"
    ? item.presentation.title
    : item.presentation.path.join(" › ");
}

export function listCommandItems(items: readonly CommandCenterContribution[]): AppActionInfo[] {
  return items.map((item) => ({
    id: `${COMMAND_PREFIX}${item.id}`,
    kind: "command" as const,
    label: commandLabel(item),
  }));
}

export function listAppActions(
  items: readonly CommandCenterContribution[],
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): AppActionInfo[] {
  return [...listKeyboardActions(bindings), ...listCommandItems(items)];
}

export type ResolvedActionId =
  | { kind: "keyboard"; action: string }
  | { kind: "command"; item: CommandCenterContribution }
  | { kind: "unknown"; id: string };

/**
 * Accepts an id as listed (`keyboard:workspace.pin`, `command:root:add-project`) and, for
 * convenience, a bare id when it is unambiguous (keyboard actions win a tie).
 */
export function resolveActionId(
  rawId: string,
  items: readonly CommandCenterContribution[],
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): ResolvedActionId {
  const id = rawId.trim();
  const keyboardIds = new Set(bindings.map((binding) => binding.action as string));
  const findCommand = (itemId: string) => items.find((item) => item.id === itemId);

  if (id.startsWith(KEYBOARD_PREFIX)) {
    const action = id.slice(KEYBOARD_PREFIX.length);
    return keyboardIds.has(action) ? { kind: "keyboard", action } : { kind: "unknown", id };
  }
  if (id.startsWith(COMMAND_PREFIX)) {
    const item = findCommand(id.slice(COMMAND_PREFIX.length));
    return item ? { kind: "command", item } : { kind: "unknown", id };
  }
  if (keyboardIds.has(id)) return { kind: "keyboard", action: id };
  const item = findCommand(id);
  return item ? { kind: "command", item } : { kind: "unknown", id };
}

const MESSAGE_INPUT_KINDS: readonly MessageInputKeyboardActionKind[] = [
  "focus",
  "send",
  "dictation-toggle",
  "dictation-cancel",
  "dictation-confirm",
  "voice-toggle",
  "voice-mute-toggle",
  "mode-cycle",
];

/** `{index: 3}`, `{delta: -1}` or `{kind: "focus"}` become the shortcut payload; nothing is null. */
export function payloadFromArgs(
  args: Record<string, unknown> | undefined,
): KeyboardShortcutPayload | { error: string } {
  if (!args) return null;
  if (args.index !== undefined) {
    const index = Number(args.index);
    return Number.isInteger(index) && index >= 1 && index <= 9
      ? { index }
      : { error: "args.index must be a whole number from 1 to 9" };
  }
  if (args.delta !== undefined) {
    return args.delta === 1 || args.delta === -1
      ? { delta: args.delta }
      : { error: "args.delta must be 1 or -1" };
  }
  if (args.kind !== undefined) {
    return typeof args.kind === "string" &&
      (MESSAGE_INPUT_KINDS as readonly string[]).includes(args.kind)
      ? { kind: args.kind as MessageInputKeyboardActionKind }
      : { error: `args.kind must be one of ${MESSAGE_INPUT_KINDS.join(", ")}` };
  }
  return null;
}

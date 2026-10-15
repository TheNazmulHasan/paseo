import {
  DEFAULT_BINDINGS,
  EXTRA_CHORD_SEPARATOR,
  helpMatchesPlatform,
  parseBindingChord,
  type ParsedShortcutBinding,
  type ShortcutOverrides,
} from "@/keyboard/keyboard-shortcuts";

/**
 * File-based keybindings (`~/.paseo/keybindings.json`): the highest-precedence
 * layer, above the defaults and the in-app overrides. This module is pure: the
 * desktop main process owns reading/watching the file and hands the raw JSON
 * array here to be validated and folded into the same `ShortcutOverrides` shape
 * the in-app overrides use, so every consumer picks it up without knowing.
 */

export type FileKeybindingPlatform = "mac" | "non-mac";

export interface FileKeybinding {
  action: string;
  /** `null` unbinds the action. */
  key: string | null;
  platform?: FileKeybindingPlatform;
  /** Targets one default binding id, for actions whose bindings carry different payloads. */
  binding?: string;
}

export interface FilePlatform {
  isMac: boolean;
  isDesktop: boolean;
}

export interface ParsedFileKeybindings {
  entries: FileKeybinding[];
  warnings: string[];
}

const COMBO_MODIFIER_ALIASES: Record<string, string> = {
  cmd: "Cmd",
  command: "Cmd",
  meta: "Cmd",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  opt: "Alt",
  option: "Alt",
  shift: "Shift",
  mod: "Mod",
};

/** Forgives case and modifier synonyms ("ctrl+cmd+o") so hand-written files just work. */
function normalizeCombo(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((step) =>
      step
        .split("+")
        .map((part) => {
          const alias = COMBO_MODIFIER_ALIASES[part.toLowerCase()];
          if (alias) return alias;
          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join("+"),
    )
    .join(" ");
}

function knownActions(): Set<string> {
  return new Set(DEFAULT_BINDINGS.map((binding) => binding.action));
}

/**
 * Validates the raw JSON value of keybindings.json. Anything wrong with an
 * entry skips that entry with a warning; nothing here throws.
 */
export function parseFileKeybindings(
  raw: unknown,
  platform: Pick<FilePlatform, "isMac">,
): ParsedFileKeybindings {
  const warnings: string[] = [];
  const entries: FileKeybinding[] = [];
  if (!Array.isArray(raw)) {
    warnings.push("keybindings.json must be a JSON array of { action, key } entries");
    return { entries, warnings };
  }
  const actions = knownActions();
  const bindingIds = new Map(DEFAULT_BINDINGS.map((b) => [b.id, b.action]));
  raw.forEach((item: unknown, index) => {
    const label = `keybindings.json entry ${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      warnings.push(`${label}: not an object, skipped`);
      return;
    }
    const { action, key, platform: entryPlatform, binding } = item as Record<string, unknown>;
    if (typeof action !== "string" || !actions.has(action)) {
      warnings.push(`${label}: unknown action ${JSON.stringify(action)}, skipped`);
      return;
    }
    if (entryPlatform !== undefined && entryPlatform !== "mac" && entryPlatform !== "non-mac") {
      warnings.push(`${label}: platform must be "mac" or "non-mac", skipped`);
      return;
    }
    if (
      binding !== undefined &&
      (typeof binding !== "string" || bindingIds.get(binding) !== action)
    ) {
      warnings.push(
        `${label}: binding ${JSON.stringify(binding)} is not a binding of ${action}, skipped`,
      );
      return;
    }
    // Entries for the other platform are valid but not for us.
    if (entryPlatform !== undefined && (entryPlatform === "mac") !== platform.isMac) {
      return;
    }
    let normalizedKey: string | null;
    if (key === null) {
      normalizedKey = null;
    } else if (typeof key === "string") {
      normalizedKey = normalizeCombo(key);
      try {
        if (normalizedKey === "") throw new Error("empty");
        parseBindingChord(normalizedKey);
      } catch {
        warnings.push(`${label}: cannot parse key ${JSON.stringify(key)}, skipped`);
        return;
      }
    } else {
      warnings.push(`${label}: key must be a combo string or null, skipped`);
      return;
    }
    entries.push({
      action,
      key: normalizedKey,
      ...(entryPlatform ? { platform: entryPlatform } : {}),
      ...(typeof binding === "string" ? { binding } : {}),
    });
  });
  return { entries, warnings };
}

function payloadKey(binding: ParsedShortcutBinding): string {
  return JSON.stringify(binding.payload ?? null);
}

/** The keys one slot (action, or a single binding) should end up with. */
function chordsForSlot(entries: FileKeybinding[]): string[] {
  const keys = entries.map((entry) => entry.key);
  const combos = keys.filter((key): key is string => key !== null);
  return combos.length > 0 ? [...new Set(combos)] : [];
}

/**
 * Folds validated entries into binding-id keyed overrides.
 *
 * Entries naming a `binding` target that one binding. Entries naming only an
 * action replace every default binding of that action on this platform, in
 * order; chords beyond the defaults become `<bindingId>#<n>` extras and
 * defaults left over are unbound. An action whose bindings carry different
 * payloads (workspace.navigate.relative, message-input.action, ...) needs
 * `binding`, because "first chord" would be a guess.
 */
export function buildFileOverrides(
  entries: readonly FileKeybinding[],
  platform: FilePlatform,
): { overrides: ShortcutOverrides; warnings: string[] } {
  const overrides: ShortcutOverrides = {};
  const warnings: string[] = [];

  const slots = new Map<string, { action: string; binding?: string; entries: FileKeybinding[] }>();
  for (const entry of entries) {
    const slotKey = entry.binding ? `binding:${entry.binding}` : `action:${entry.action}`;
    const slot = slots.get(slotKey) ?? {
      action: entry.action,
      binding: entry.binding,
      entries: [],
    };
    slot.entries.push(entry);
    slots.set(slotKey, slot);
  }

  for (const slot of slots.values()) {
    const chords = chordsForSlot(slot.entries);
    const forAction = DEFAULT_BINDINGS.filter((b) => b.action === slot.action);
    const targets = slot.binding
      ? forAction.filter((b) => b.id === slot.binding)
      : forAction.filter((b) => helpMatchesPlatform(b.when, platform));

    if (!slot.binding && new Set(targets.map(payloadKey)).size > 1) {
      warnings.push(
        `keybindings.json: ${slot.action} has several bindings with different payloads; ` +
          `use "binding" (see keybindings.defaults.json), skipped`,
      );
      continue;
    }
    const anchor = targets[0] ?? forAction[0];
    if (!anchor) continue;

    targets.forEach((target, index) => {
      overrides[target.id] = chords[index] ?? null;
    });
    chords.slice(Math.max(targets.length, 1)).forEach((chord, offset) => {
      overrides[`${anchor.id}${EXTRA_CHORD_SEPARATOR}${offset + 2}`] = chord;
    });
    // No default binding on this platform to replace: the first chord rides on the anchor clone.
    if (targets.length === 0 && chords[0] !== undefined) {
      overrides[`${anchor.id}${EXTRA_CHORD_SEPARATOR}1`] = chords[0];
    }
  }
  return { overrides, warnings };
}

/** default < in-app override < keybindings.json */
export function mergeShortcutOverrides(
  stored: ShortcutOverrides,
  fromFile: ShortcutOverrides,
): ShortcutOverrides {
  return Object.keys(fromFile).length === 0 ? stored : { ...stored, ...fromFile };
}

// --- keybindings.defaults.json (agent-readable dump of every default) ---

const DEFAULTS_HEADER = `// Paseo keyboard shortcuts: DEFAULTS. Generated by Paseo on every app start; overwritten, do not edit.
//
// To change a shortcut, edit ~/.paseo/keybindings.json (create it if missing). Changes apply live, no restart.
// It is a JSON array (// comments are allowed). Each entry:
//   { "action": "<action id below>", "key": "Ctrl+Cmd+O" }
//   { "action": "<action id>", "key": null }                         unbind the action
//   { "action": "<action id>", "key": "Alt+K", "platform": "mac" }  limit to "mac" or "non-mac"
//   { "action": "<action id>", "binding": "<binding id>", "key": "Alt+K" }
//        "binding" targets ONE default binding; required for actions that list several
//        bindings with a "payload" (workspace.navigate.relative, message-input.action, ...).
// Several entries for one action = several chords. An action with entries REPLACES all its defaults.
// Key syntax: modifiers Cmd, Ctrl, Alt, Shift joined with "+" then one key: "Cmd+Ctrl+G", "Alt+Shift+Left",
// "Mod+K" (Cmd on mac, Ctrl elsewhere). A space between combos makes a chord sequence: "Cmd+K Cmd+S".
// keybindings.json wins over the in-app Settings > Keyboard shortcuts overrides, which win over these defaults.
// Bad entries (unknown action, unparsable key) are skipped with a console warning.
`;

export function buildDefaultsDump(version: string | null): string {
  const byAction = new Map<string, ParsedShortcutBinding[]>();
  for (const binding of DEFAULT_BINDINGS) {
    byAction.set(binding.action, [...(byAction.get(binding.action) ?? []), binding]);
  }
  const rowsFor = (bindings: ParsedShortcutBinding[], mac: boolean) => {
    const rows: Record<string, unknown>[] = [];
    for (const b of bindings) {
      if (b.when?.mac !== undefined && b.when.mac !== mac) continue;
      const row: Record<string, unknown> = { binding: b.id, key: b.combo === "" ? null : b.combo };
      if (b.payload) row.payload = b.payload;
      if (b.when?.desktop !== undefined) row.desktopOnly = b.when.desktop;
      rows.push(row);
    }
    return rows;
  };
  const actions = [...byAction.entries()].map(([action, bindings]) => {
    const help = bindings.find((b) => b.help)?.help;
    return {
      action,
      label: help?.label ?? null,
      section: help?.section ?? null,
      mac: rowsFor(bindings, true),
      "non-mac": rowsFor(bindings, false),
    };
  });
  return `${DEFAULTS_HEADER}${JSON.stringify({ version, actions }, null, 2)}\n`;
}

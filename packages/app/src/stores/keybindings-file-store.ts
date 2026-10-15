import { create } from "zustand";
import { buildFileOverrides, parseFileKeybindings } from "@/keyboard/file-keybindings";
import type { ShortcutOverrides } from "@/keyboard/keyboard-shortcuts";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getIsElectronRuntime } from "@/constants/layout";

const EMPTY_OVERRIDES: ShortcutOverrides = {};

interface KeybindingsFileState {
  /** Binding-id keyed overrides derived from ~/.paseo/keybindings.json; always wins. */
  overrides: ShortcutOverrides;
  /** Takes the raw entries array pushed by the desktop main process. */
  applyRawEntries: (raw: unknown) => void;
}

export const useKeybindingsFileStore = create<KeybindingsFileState>((set) => ({
  overrides: EMPTY_OVERRIDES,
  applyRawEntries: (raw) => {
    const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectronRuntime() };
    const parsed = parseFileKeybindings(Array.isArray(raw) ? raw : [], platform);
    const built = buildFileOverrides(parsed.entries, platform);
    for (const warning of [...parsed.warnings, ...built.warnings]) {
      console.warn(`[Keybindings] ${warning}`);
    }
    set({
      overrides: Object.keys(built.overrides).length === 0 ? EMPTY_OVERRIDES : built.overrides,
    });
  },
}));

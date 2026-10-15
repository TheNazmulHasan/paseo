import { describe, expect, it } from "vitest";
import {
  buildDefaultsDump,
  buildFileOverrides,
  mergeShortcutOverrides,
  parseFileKeybindings,
} from "@/keyboard/file-keybindings";
import {
  buildEffectiveBindings,
  DEFAULT_BINDINGS,
  resolveKeyboardShortcut,
  resolveShortcutKeysForAction,
} from "@/keyboard/keyboard-shortcuts";

const MAC = { isMac: true, isDesktop: true };
const NON_MAC = { isMac: false, isDesktop: true };

describe("parseFileKeybindings", () => {
  it("accepts valid entries and normalizes the combo", () => {
    const { entries, warnings } = parseFileKeybindings(
      [{ action: "workspace.board.split", key: "ctrl+cmd+o" }],
      MAC,
    );
    expect(warnings).toEqual([]);
    expect(entries).toEqual([{ action: "workspace.board.split", key: "Ctrl+Cmd+O" }]);
  });

  it("keeps null as an unbind", () => {
    const { entries } = parseFileKeybindings([{ action: "theme.cycle", key: null }], MAC);
    expect(entries).toEqual([{ action: "theme.cycle", key: null }]);
  });

  it("drops entries for the other platform without a warning", () => {
    const raw = [
      { action: "theme.cycle", key: "Cmd+Alt+T", platform: "mac" },
      { action: "theme.cycle", key: "Ctrl+Alt+T", platform: "non-mac" },
    ];
    expect(parseFileKeybindings(raw, MAC)).toEqual({
      entries: [{ action: "theme.cycle", key: "Cmd+Alt+T", platform: "mac" }],
      warnings: [],
    });
    expect(parseFileKeybindings(raw, NON_MAC).entries).toEqual([
      { action: "theme.cycle", key: "Ctrl+Alt+T", platform: "non-mac" },
    ]);
  });

  it("skips unknown actions, bad combos and junk with a warning", () => {
    const { entries, warnings } = parseFileKeybindings(
      [
        { action: "nope.nothing", key: "Cmd+K" },
        { action: "theme.cycle", key: "Cmd+Banana" },
        { action: "theme.cycle", key: "" },
        { action: "theme.cycle", key: 5 },
        { action: "theme.cycle", key: "Cmd+K", platform: "linux" },
        { action: "theme.cycle", key: "Cmd+K", binding: "not-a-binding" },
        "junk",
        null,
      ],
      MAC,
    );
    expect(entries).toEqual([]);
    expect(warnings).toHaveLength(8);
  });

  it("rejects a non-array document", () => {
    const result = parseFileKeybindings({ action: "theme.cycle" }, MAC);
    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("buildFileOverrides", () => {
  const bindingFor = (action: string, mac: boolean) =>
    DEFAULT_BINDINGS.find((b) => b.action === action && (b.when?.mac ?? mac) === mac)!;

  it("replaces the action's binding for this platform only", () => {
    const { overrides } = buildFileOverrides(
      [{ action: "workspace.board.split", key: "Cmd+Ctrl+Y" }],
      MAC,
    );
    expect(overrides).toEqual({ [bindingFor("workspace.board.split", true).id]: "Cmd+Ctrl+Y" });
  });

  it("unbinds with null", () => {
    const { overrides } = buildFileOverrides([{ action: "workspace.board.split", key: null }], MAC);
    expect(overrides).toEqual({ [bindingFor("workspace.board.split", true).id]: null });
  });

  it("turns extra chords into extra bindings", () => {
    const { overrides } = buildFileOverrides(
      [
        { action: "workspace.board.split", key: "Cmd+Ctrl+Y" },
        { action: "workspace.board.split", key: "Cmd+Ctrl+U" },
      ],
      MAC,
    );
    const id = bindingFor("workspace.board.split", true).id;
    expect(overrides).toEqual({ [id]: "Cmd+Ctrl+Y", [`${id}#2`]: "Cmd+Ctrl+U" });
    const effective = buildEffectiveBindings(overrides);
    const fires = (code: string, key: string) =>
      resolveKeyboardShortcut({
        event: {
          key,
          code,
          ctrlKey: true,
          metaKey: true,
          altKey: false,
          shiftKey: false,
          repeat: false,
        },
        context: { ...MAC, focusScope: "other", commandCenterOpen: false },
        chordState: { candidateIndices: [], step: 0, timeoutId: null },
        onChordReset: () => {},
        bindings: effective,
      }).match?.action;
    expect(fires("KeyY", "y")).toBe("workspace.board.split");
    expect(fires("KeyU", "u")).toBe("workspace.board.split");
    expect(fires("KeyO", "o")).toBeUndefined();
  });

  it("refuses an action with several payloads unless a binding is named", () => {
    const { overrides, warnings } = buildFileOverrides(
      [{ action: "workspace.navigate.relative", key: "Cmd+Alt+Y" }],
      MAC,
    );
    expect(overrides).toEqual({});
    expect(warnings).toHaveLength(1);
    const target = DEFAULT_BINDINGS.find(
      (b) => b.id === "workspace-navigate-relative-cmd-left-mac",
    )!;
    expect(
      buildFileOverrides([{ action: target.action, binding: target.id, key: "Cmd+Alt+Y" }], MAC)
        .overrides,
    ).toEqual({ [target.id]: "Cmd+Alt+Y" });
  });
});

describe("precedence: default < in-app override < file", () => {
  const id = DEFAULT_BINDINGS.find(
    (b) => b.action === "workspace.board.split" && b.when?.mac === true,
  )!.id;
  const display = (overrides: Parameters<typeof resolveShortcutKeysForAction>[1]) =>
    resolveShortcutKeysForAction("workspace-board-split", overrides, MAC);

  it("falls back to the default, then the in-app override, then the file", () => {
    const stored = { [id]: "Cmd+Ctrl+Y" };
    const file = { [id]: "Cmd+Ctrl+U" };
    expect(display({})).toEqual(display(mergeShortcutOverrides({}, {})));
    expect(
      buildEffectiveBindings(mergeShortcutOverrides(stored, {})).find((b) => b.id === id)?.combo,
    ).toBe("Cmd+Ctrl+Y");
    expect(
      buildEffectiveBindings(mergeShortcutOverrides(stored, file)).find((b) => b.id === id)?.combo,
    ).toBe("Cmd+Ctrl+U");
    expect(display(mergeShortcutOverrides(stored, file))).not.toEqual(display(stored));
  });

  it("lets the file unbind over an in-app override", () => {
    const merged = mergeShortcutOverrides({ [id]: "Cmd+Ctrl+Y" }, { [id]: null });
    expect(buildEffectiveBindings(merged).find((b) => b.id === id)?.parsedChord).toEqual([]);
    expect(display(merged)).toBeNull();
  });

  it("returns the stored map untouched when the file is empty", () => {
    const stored = { [id]: "Cmd+Ctrl+Y" };
    expect(mergeShortcutOverrides(stored, {})).toBe(stored);
  });
});

describe("buildDefaultsDump", () => {
  it("documents the format and lists every default binding", () => {
    const dump = buildDefaultsDump("1.2.3");
    expect(dump.startsWith("// Paseo keyboard shortcuts: DEFAULTS")).toBe(true);
    const json = JSON.parse(
      dump
        .split("\n")
        .filter((line) => !line.startsWith("//"))
        .join("\n"),
    );
    expect(json.version).toBe("1.2.3");
    const split = json.actions.find(
      (a: { action: string }) => a.action === "workspace.board.split",
    );
    expect(split.mac[0].key).toBe("Cmd+Ctrl+O");
    expect(split["non-mac"][0].key).toBe("Ctrl+Alt+O");
    expect(split.label).toBe("Split workspaces");
  });
});

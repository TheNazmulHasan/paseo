import { describe, expect, it, vi } from "vitest";
import { parseFileKeybindings, buildFileOverrides } from "@/keyboard/file-keybindings";
import { routeKeyboardShortcut, type ShortcutRoutingContext } from "@/keyboard/route-shortcut";
import {
  buildEffectiveBindings,
  DEFAULT_BINDINGS,
  resolveKeyboardShortcut,
  resolveShortcutKeysForAction,
} from "@/keyboard/keyboard-shortcuts";
import {
  buildHomeContributions,
  HOME_OPEN_HELP_ID,
  OPEN_HOME_COMMAND_ID,
} from "./home-contributions";
import { buildHomeRoute, HOME_ROUTE, isHomePathname } from "./route";

const MAC = { isMac: true, isDesktop: true };

const ctx: ShortcutRoutingContext = {
  pathname: "/h/srv/workspace/ws-2",
  isMobile: false,
  sidebarShortcutTargets: [],
  navigationActiveWorkspace: null,
  commandCenterOpen: false,
  shortcutsDialogOpen: false,
};

describe("Open Home in the Command Center", () => {
  it("is one always-visible action that runs the open callback", () => {
    const open = vi.fn();
    const [item, ...rest] = buildHomeContributions({
      title: "Open Home",
      sectionTitle: "Actions",
      open,
    });
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      id: OPEN_HOME_COMMAND_ID,
      group: "actions",
      visibility: "always",
      presentation: { kind: "action", title: "Open Home", sectionTitle: "Actions" },
    });
    void item.run();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("Home route", () => {
  it("is /home, global like /sessions", () => {
    expect(HOME_ROUTE).toBe("/home");
    expect(buildHomeRoute()).toBe("/home");
    expect(isHomePathname("/home")).toBe(true);
    expect(isHomePathname("/h/srv/workspace/ws-1")).toBe(false);
    expect(isHomePathname("/sessions")).toBe(false);
  });
});

describe("home.open keyboard action", () => {
  const bindings = DEFAULT_BINDINGS.filter((binding) => binding.action === "home.open");

  it("exists with NO default key, for every platform", () => {
    expect(bindings).toHaveLength(1);
    expect(bindings[0].combo).toBe("");
    expect(bindings[0].parsedChord).toEqual([]);
    expect(resolveShortcutKeysForAction(HOME_OPEN_HELP_ID, {}, MAC)).toBeNull();
    expect(
      resolveShortcutKeysForAction(HOME_OPEN_HELP_ID, {}, { isMac: false, isDesktop: true }),
    ).toBeNull();
  });

  const press = (overrides: Record<string, string | null>) =>
    resolveKeyboardShortcut({
      event: {
        key: "h",
        code: "KeyH",
        ctrlKey: true,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        repeat: false,
      },
      context: { isMac: true, isDesktop: true, focusScope: "other", commandCenterOpen: false },
      chordState: { candidateIndices: [], step: 0, timeoutId: null },
      onChordReset: () => {},
      bindings: buildEffectiveBindings(overrides),
    });

  it("is not fired by any key press until a key is assigned", () => {
    expect(press({}).match?.action).not.toBe("home.open");
  });

  it("fires once the keymap owner assigns Ctrl+Cmd+H", () => {
    const { entries } = parseFileKeybindings([{ action: "home.open", key: "ctrl+cmd+h" }], MAC);
    const { overrides } = buildFileOverrides(entries, MAC);
    expect(press(overrides).match?.action).toBe("home.open");
  });

  it("routes straight to the Home route", () => {
    expect(routeKeyboardShortcut({ action: "home.open", payload: null }, ctx)).toEqual({
      kind: "router-push",
      route: "/home",
    });
  });

  it("can be bound from keybindings.json by the keymap owner", () => {
    const { entries, warnings } = parseFileKeybindings(
      [{ action: "home.open", key: "ctrl+cmd+h" }],
      MAC,
    );
    expect(warnings).toEqual([]);
    expect(entries).toEqual([{ action: "home.open", key: "Ctrl+Cmd+H" }]);
    const { overrides } = buildFileOverrides(entries, MAC);
    const keys = resolveShortcutKeysForAction(HOME_OPEN_HELP_ID, overrides, MAC);
    expect(keys).not.toBeNull();
  });
});

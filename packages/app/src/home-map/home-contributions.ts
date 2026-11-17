import type { CommandCenterContribution, CommandCenterIcon } from "@/command-center/contributions";
import type { ShortcutKey } from "@/utils/format-shortcut";

/** The Command Center id Chief can run as `command:open-home`. */
export const OPEN_HOME_COMMAND_ID = "open-home";

/** The help id of the `home.open` keyboard action; the user's keymap owner assigns its keys. */
export const HOME_OPEN_HELP_ID = "home-open";

/**
 * "Open Home" (fork mod, home-map). It sits in the root Actions group next to the upstream "Home"
 * item (which opens the open-project screen, not this one), so the title says "Open Home".
 */
export function buildHomeContributions(source: {
  title: string;
  sectionTitle: string;
  icon?: CommandCenterIcon;
  shortcutKeys?: ShortcutKey[][];
  open(): void;
}): CommandCenterContribution[] {
  return [
    {
      id: OPEN_HOME_COMMAND_ID,
      group: "actions",
      groupRank: 0,
      rank: 3.5,
      keywords: ["home", "map", "needs", "pending", "overview", "chief", "start"],
      visibility: "always",
      run: () => source.open(),
      presentation: {
        kind: "action",
        title: source.title,
        sectionTitle: source.sectionTitle,
        icon: source.icon,
        shortcutKeys: source.shortcutKeys,
      },
    },
  ];
}

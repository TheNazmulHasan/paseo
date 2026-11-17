import { useMemo } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react-native";
import { getCommandCenterIcon } from "@/command-center/icon";
import { useCommandCenterActions } from "@/command-center/provider";
import { getIsElectronRuntime } from "@/constants/layout";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { buildHomeContributions, HOME_OPEN_HELP_ID } from "./home-contributions";
import { buildHomeRoute } from "./route";

const HOME_ICON = getCommandCenterIcon(Home);

/**
 * Nazmul mod (home-map): registers "Open Home" in the Command Center. Renders nothing. Mounted
 * once, under CommandCenterProvider, beside ChiefHost. The `home.open` keyboard action needs no
 * handler here: it routes straight to the Home route (`keyboard/route-shortcut.ts`).
 */
export function HomeMapHost() {
  const { t } = useTranslation();
  const { overrides } = useKeyboardShortcutOverrides();
  const actions = useMemo(
    () =>
      buildHomeContributions({
        title: t("homeMap.commandCenter.open"),
        sectionTitle: t("shell.commandCenter.actions"),
        icon: HOME_ICON,
        shortcutKeys:
          resolveShortcutKeysForAction(HOME_OPEN_HELP_ID, overrides, {
            isMac: getShortcutOs() === "mac",
            isDesktop: getIsElectronRuntime(),
          }) ?? undefined,
        open: () => {
          clearCommandCenterFocusRestoreElement();
          router.push(buildHomeRoute());
        },
      }),
    [overrides, t],
  );
  useCommandCenterActions({ sourceId: "home-map", enabled: true, actions });
  return null;
}

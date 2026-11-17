import { useCallback } from "react";
import { router, usePathname } from "expo-router";
import { Home } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { HOME_OPEN_HELP_ID } from "./home-contributions";
import { buildHomeRoute, isHomePathname } from "./route";

/**
 * Nazmul mod (home-map): the Home entry at the top of the sidebar's nav block, above New
 * workspace. It is not one of the configurable nav items (see `sidebar-nav/model.ts`): Home is
 * where Paseo starts and the answer to "what needs me", so it cannot be hidden by accident, and it
 * stays first for users who already saved a nav order.
 */
export function SidebarHomeRow({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const shortcutKeys = useShortcutKeys(HOME_OPEN_HELP_ID);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildHomeRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Home}
      label={t("homeMap.title")}
      onPress={handlePress}
      isActive={isHomePathname(pathname)}
      testID="sidebar-home"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

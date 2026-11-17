import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";

/**
 * Nazmul mod (home-map): "Open Home on launch". On by default; turn it off to start Paseo on the
 * last workspace again. Desktop only, because only the desktop app's cold start lands on Home.
 */
export function OpenHomeSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleChange = useCallback(
    (openHomeOnLaunch: boolean) => void updateSettings({ openHomeOnLaunch }),
    [updateSettings],
  );

  return (
    <SettingsSection title={t("homeMap.title")}>
      <SettingsCard testID="open-home-card">
        <SettingsSwitch
          label={t("homeMap.launch.label")}
          hint={t("homeMap.launch.description")}
          value={settings.openHomeOnLaunch}
          onValueChange={handleChange}
          testID="open-home-on-launch-switch"
        />
      </SettingsCard>
    </SettingsSection>
  );
}

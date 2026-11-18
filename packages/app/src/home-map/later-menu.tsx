import { memo, useCallback } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { HomeSnoozePreset } from "@getpaseo/protocol/home";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";

const ThemedChevron = withUnistyles(ChevronDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const PRESETS: readonly { preset: HomeSnoozePreset; labelKey: string }[] = [
  { preset: "3h", labelKey: "homeMap.queue.snooze.threeHours" },
  { preset: "tomorrow", labelKey: "homeMap.queue.snooze.tomorrow" },
  { preset: "nextweek", labelKey: "homeMap.queue.snooze.nextWeek" },
];

function PresetItem({
  preset,
  label,
  onSelect,
}: {
  preset: HomeSnoozePreset;
  label: string;
  onSelect: (preset: HomeSnoozePreset) => void;
}) {
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  return (
    <DropdownMenuItem onSelect={handleSelect} testID={`home-later-${preset}`}>
      {label}
    </DropdownMenuItem>
  );
}

/**
 * "Later ▾": put the session off for 3 hours, until tomorrow 09:00 or next Monday 09:00. Always
 * visible. Controlled, so the L key can open it for the focused item.
 */
export const LaterMenu = memo(function LaterMenu({
  open,
  onOpenChange,
  onSelect,
  testID,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (preset: HomeSnoozePreset) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        accessibilityLabel={t("homeMap.queue.later")}
        style={styles.trigger}
        testID={testID}
      >
        <Text style={styles.triggerText}>{t("homeMap.queue.later")}</Text>
        <ThemedChevron size={12} uniProps={mutedMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={200}>
        {PRESETS.map(({ preset, labelKey }) => (
          <PresetItem key={preset} preset={preset} label={t(labelKey)} onSelect={onSelect} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));

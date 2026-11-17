import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import {
  MenuItem,
  MenuRoot,
  MenuSurface,
  MenuTrigger,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { isWeb } from "@/constants/platform";
import type { DeskGrouping } from "@/desk/model";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface DeskGroupingOption {
  value: DeskGrouping;
  label: string;
  testID: string;
}

function GroupingMenuItem({
  option,
  selected,
  onChange,
}: {
  option: DeskGroupingOption;
  selected: boolean;
  onChange: (grouping: DeskGrouping) => void;
}) {
  const handleSelect = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <MenuItem selected={selected} onSelect={handleSelect} testID={option.testID}>
      {option.label}
    </MenuItem>
  );
}

/**
 * The Desk's grouping control on its folder row: one compact, always-visible button that names the
 * current grouping (Recent, Project, ...) and opens a small menu with the others. It stands where
 * the four-chip control used to be, which is too wide for a folder row.
 */
export function DeskGroupingMenu({
  options,
  value,
  onChange,
}: {
  options: readonly DeskGroupingOption[];
  value: DeskGrouping;
  onChange: (grouping: DeskGrouping) => void;
}) {
  const { t } = useTranslation();
  const current = options.find((option) => option.value === value) ?? options[0];
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerHovered,
    ],
    [],
  );
  const accessibilityLabel = useMemo(
    () => `${t("sidebar.desk.groupBy")}: ${current?.label ?? ""}`,
    [current?.label, t],
  );

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={accessibilityLabel}
        testID="sidebar-desk-grouping"
      >
        <Text style={styles.label} numberOfLines={1}>
          {current?.label}
        </Text>
        <ThemedChevronDown size={10} uniProps={mutedMapping} />
      </MenuTrigger>
      <MenuSurface
        align="end"
        minWidth={140}
        sheetTitle={t("sidebar.desk.groupBy")}
        testID="sidebar-desk-grouping-menu"
      >
        {options.map((option) => (
          <GroupingMenuItem
            key={option.value}
            option={option}
            selected={option.value === value}
            onChange={onChange}
          />
        ))}
      </MenuSurface>
    </MenuRoot>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    height: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

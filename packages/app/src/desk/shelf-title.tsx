import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useDeskStore } from "@/desk/desk-store";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The Shelf's header title: "Shelf", how many workspaces it holds, and the fold chevron. It
 * replaces the plain "Workspaces" label, so the grouping control and the display menu next to it
 * stay reachable while the Shelf is folded.
 */
export function ShelfTitle() {
  const { t } = useTranslation();
  const { shelfCount } = useSidebarModel();
  const collapsed = useDeskStore((state) => state.shelfCollapsed);
  const toggleCollapsed = useDeskStore((state) => state.toggleShelfCollapsed);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={toggleCollapsed}
      style={styles.title}
      testID="sidebar-shelf-header"
    >
      <Chevron size={12} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.label} numberOfLines={1}>
        {t("sidebar.shelf.title")}
      </Text>
      <Text style={styles.count} testID="sidebar-shelf-count">
        {shelfCount}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
    userSelect: "none",
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.7,
  },
}));

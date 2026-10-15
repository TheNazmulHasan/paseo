import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

/** Appears under the Desk header once two or more workspaces are checked. Always visible. */
export function DeskSelectionBar({
  count,
  onColumns,
  onGrid,
  onCancel,
}: {
  count: number;
  onColumns: () => void;
  onGrid: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar} testID="sidebar-desk-selection-bar">
      <Text style={styles.count} numberOfLines={1}>
        {t("sidebar.desk.selectedCount", { count })}
      </Text>
      <View style={styles.actions}>
        <Button
          variant="default"
          size="sm"
          onPress={onColumns}
          testID="sidebar-desk-select-columns"
        >
          {t("sidebar.desk.viewColumns")}
        </Button>
        <Button variant="secondary" size="sm" onPress={onGrid} testID="sidebar-desk-select-grid">
          {t("sidebar.desk.viewGrid")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onCancel} testID="sidebar-desk-select-cancel">
          {t("sidebar.desk.selectCancel")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));

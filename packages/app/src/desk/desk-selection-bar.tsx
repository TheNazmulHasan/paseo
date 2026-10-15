import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

/**
 * Appears under the Desk header once a workspace is checked. Always visible. Columns and Grid make
 * a new view (two or more); the second row fills the active view: Add puts the checked workspaces
 * beside its panes, Empty + add swaps its panes for them. That row shows once a view was opened.
 */
export function DeskSelectionBar({
  count,
  targetViewName,
  onColumns,
  onGrid,
  onAddToView,
  onReplaceView,
  onCancel,
}: {
  count: number;
  targetViewName: string | null;
  onColumns: () => void;
  onGrid: () => void;
  onAddToView: () => void;
  onReplaceView: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const canSplit = count >= 2;
  return (
    <View style={styles.bar} testID="sidebar-desk-selection-bar">
      <View style={styles.row}>
        <Text style={styles.count} numberOfLines={1}>
          {t("sidebar.desk.selectedCount", { count })}
        </Text>
        <View style={styles.actions}>
          <Button
            variant="default"
            size="sm"
            onPress={onColumns}
            disabled={!canSplit}
            testID="sidebar-desk-select-columns"
          >
            {t("sidebar.desk.viewColumns")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={onGrid}
            disabled={!canSplit}
            testID="sidebar-desk-select-grid"
          >
            {t("sidebar.desk.viewGrid")}
          </Button>
          <Button variant="ghost" size="sm" onPress={onCancel} testID="sidebar-desk-select-cancel">
            {t("sidebar.desk.selectCancel")}
          </Button>
        </View>
      </View>
      {targetViewName !== null ? (
        <View style={styles.viewRow} testID="sidebar-desk-select-view-row">
          <Text style={styles.viewName} numberOfLines={1}>
            {t("sidebar.desk.activeView", { name: targetViewName })}
          </Text>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              onPress={onAddToView}
              testID="sidebar-desk-select-add-to-view"
            >
              {t("sidebar.desk.addToView", { count })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onPress={onReplaceView}
              testID="sidebar-desk-select-replace-view"
            >
              {t("sidebar.desk.replaceView", { count })}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  viewRow: {
    gap: theme.spacing[1],
  },
  viewName: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));

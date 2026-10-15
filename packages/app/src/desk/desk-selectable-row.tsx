import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { wasMetaHeldOnLastPointerDown } from "@/desk/desk-selection-store";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

/**
 * A Desk row in the Desk's selection mode: a checkbox at the left, and the row itself toggles
 * the checkbox instead of opening the workspace. Outside selection mode it adds nothing, except
 * that Cmd+click starts a selection.
 */
export const DeskSelectableRow = memo(function DeskSelectableRow({
  workspaceKey,
  name,
  selectionActive,
  checked,
  onToggle,
  children,
}: {
  workspaceKey: string;
  name: string;
  selectionActive: boolean;
  checked: boolean;
  onToggle: (workspaceKey: string) => void;
  /** Receives the press interceptor to hand to the sidebar row. */
  children: (onPressIntercept: () => boolean) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => onToggle(workspaceKey), [onToggle, workspaceKey]);
  const intercept = useCallback(() => {
    if (selectionActive || wasMetaHeldOnLastPointerDown()) {
      onToggle(workspaceKey);
      return true;
    }
    return false;
  }, [onToggle, selectionActive, workspaceKey]);
  const accessibilityState = useMemo(() => ({ checked }), [checked]);

  if (!selectionActive) {
    return <>{children(intercept)}</>;
  }
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={accessibilityState}
        accessibilityLabel={t("sidebar.desk.selectRow", { name })}
        onPress={handleToggle}
        style={[styles.box, checked && styles.boxChecked]}
        testID={`sidebar-desk-checkbox-${workspaceKey}`}
      >
        {checked ? <ThemedCheck size={12} uniProps={checkedIconMapping} /> : null}
      </Pressable>
      <View style={styles.content}>{children(intercept)}</View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  box: {
    width: 18,
    height: 18,
    marginLeft: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));

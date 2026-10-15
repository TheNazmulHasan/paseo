import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/** Toast body with an inline Undo; the toast host has no action slot, but it renders any node. */
export function DeskUndoToast({
  message,
  undoLabel,
  onUndo,
}: {
  message: string;
  undoLabel: string;
  onUndo: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel={undoLabel}
        testID="desk-clear-undo"
      >
        <Text style={styles.undo}>{undoLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  message: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  undo: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textDecorationLine: "underline",
  },
}));

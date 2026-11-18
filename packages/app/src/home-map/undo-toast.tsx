import { memo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { HomeButton } from "./home-button";

/** "Closed “Title”. Undo": the content of the toast after a close. Undo works for 10 seconds. */
export const UndoToast = memo(function UndoToast({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      <HomeButton kind="plain" onPress={onUndo} testID="home-undo">
        {t("homeMap.toasts.undo")}
      </HomeButton>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minWidth: 0,
  },
  message: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));

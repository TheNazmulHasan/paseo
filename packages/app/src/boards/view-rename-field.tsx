import React, { useCallback, useRef, useState } from "react";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { createRenameSession } from "@/boards/views-model";

/**
 * The inline name box of a Views sidebar row. Enter saves, clicking away saves, Escape cancels
 * (see `createRenameSession`). Callbacks are read through refs, so a parent re-render that
 * hands over new functions never restarts the edit or loses what was typed.
 */
export function ViewRenameField({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const [session] = useState(() =>
    createRenameSession({
      initialValue,
      onCommit: (name) => commitRef.current(name),
      onCancel: () => cancelRef.current(),
    }),
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape") {
        session.cancel();
      }
    },
    [session],
  );
  return (
    <AdaptiveTextInput
      autoFocus
      selectTextOnFocus
      initialValue={initialValue}
      onChangeText={session.change}
      onSubmitEditing={session.submit}
      onBlur={session.blur}
      onKeyPress={handleKeyPress}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      style={styles.renameInput}
      testID="sidebar-view-rename-input"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  renameInput: {
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[1],
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
}));

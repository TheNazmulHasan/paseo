import { memo, useCallback, useMemo } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { Theme } from "@/styles/theme";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The small always-visible icon button the Desk puts on rows and on its own header. */
export const DeskIconButton = memo(function DeskIconButton({
  icon: Icon,
  label,
  shortcutKeys = null,
  onPress,
  testID,
  size = 14,
}: {
  icon: LucideIcon;
  label: string;
  shortcutKeys?: ShortcutKey[][] | null;
  onPress: () => void;
  testID: string;
  size?: number;
}) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) && styles.buttonHovered,
    ],
    [],
  );
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // The button sits inside a pressable row; it must never also open the workspace.
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          style={pressableStyle}
          onPress={handlePress}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={label}
          testID={testID}
        >
          {({ hovered, pressed }) => (
            <ThemedIcon
              size={size}
              uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{label}</Text>
          {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

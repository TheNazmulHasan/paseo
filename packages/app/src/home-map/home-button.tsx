import { memo, type ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

export type HomeButtonKind = "go" | "quiet" | "plain";

/**
 * The buttons on Home, always visible, never hover-only. `go` is the green primary (Open),
 * `plain` a quiet outlined button (Refresh, Sweep them, Close them), `quiet` a text-only one
 * (Later, Close). All are small so a row of them stays one line.
 */
export const HomeButton = memo(function HomeButton({
  kind,
  children,
  onPress,
  disabled,
  loading,
  testID,
  accessibilityLabel,
}: {
  kind: HomeButtonKind;
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Button
      variant={kind === "quiet" ? "ghost" : "secondary"}
      size="sm"
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={buttonStyle(kind)}
      textStyle={kind === "go" ? styles.goText : undefined}
    >
      {children}
    </Button>
  );
});

function buttonStyle(kind: HomeButtonKind) {
  if (kind === "go") return styles.go;
  if (kind === "plain") return styles.plain;
  return undefined;
}

const styles = StyleSheet.create((theme) => ({
  go: {
    backgroundColor: `${theme.colors.statusDotSuccess}26`,
    borderColor: `${theme.colors.statusDotSuccess}80`,
  },
  goText: {
    color: theme.colors.statusDotSuccess,
  },
  plain: {
    backgroundColor: "transparent",
    borderColor: theme.colors.border,
  },
}));

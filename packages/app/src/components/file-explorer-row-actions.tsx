import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Check, Copy, FolderOpen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ExplorerRowActionsProps {
  onCopyPath: () => void | Promise<void>;
  /** Absent when no file manager target exists (remote daemon, non-desktop). */
  onReveal?: () => void;
  revealTargetName?: string;
  testID?: string;
}

const COPIED_RESET_MS = 1500;
const ICON_SIZE = 13;

/**
 * Nazmul mod: the two actions he reaches for on every Files row — Copy path and Reveal in
 * Finder — as always-visible icons at the row's right edge, so the right-click menu is never
 * the only way to them. Click on the row itself still opens the entry.
 */
export function ExplorerRowActions({
  onCopyPath,
  onReveal,
  revealTargetName,
  testID,
}: ExplorerRowActionsProps): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );
  const handleCopy = useCallback(() => {
    void (async () => {
      await onCopyPath();
      setCopied(true);
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => {
        setCopied(false);
        resetRef.current = null;
      }, COPIED_RESET_MS);
    })();
  }, [onCopyPath]);

  return (
    <View style={styles.row}>
      {onReveal && revealTargetName ? (
        <RowActionButton
          icon={FolderOpen}
          label={t("workspace.fileActions.revealIn", { target: revealTargetName })}
          onPress={onReveal}
          testID={testID ? `${testID}-reveal` : undefined}
        />
      ) : null}
      <RowActionButton
        icon={copied ? Check : Copy}
        label={copied ? t("message.actions.copied") : t("workspace.fileActions.copyPath")}
        onPress={handleCopy}
        testID={testID ? `${testID}-copy-path` : undefined}
      />
    </View>
  );
}

function RowActionButton({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}): ReactElement {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={4}
        style={styles.button}
        testID={testID}
      >
        {({ hovered }) => (
          <Icon
            size={ICON_SIZE}
            color={hovered ? styles.iconHoveredColor.color : styles.iconColor.color}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <Text selectable={false} style={styles.tooltipText}>
          {label}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  button: {
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

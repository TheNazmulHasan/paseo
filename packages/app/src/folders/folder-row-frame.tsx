import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One folder row's look: fold chevron, a leading glyph, the name, the count, then the always-visible
 * actions at the trailing edge. The user folders and the built-in Desk folder both draw it, so the
 * two cannot drift apart. `editor` swaps the name (and the fold press) for an inline rename box.
 */
export function FolderHeaderFrame({
  rowTestID,
  toggleTestID,
  countTestID,
  name,
  count,
  open,
  onToggle,
  lead,
  actions,
  editor,
}: {
  rowTestID: string;
  toggleTestID: string;
  countTestID: string;
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  lead: ReactNode;
  actions?: ReactNode;
  editor?: ReactNode;
}) {
  const Chevron = open ? ThemedChevronDown : ThemedChevronRight;
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);

  if (editor) {
    return (
      <View style={styles.headerRow} testID={rowTestID}>
        {lead}
        <View style={styles.nameSlot}>{editor}</View>
      </View>
    );
  }

  return (
    <View style={styles.headerRow} testID={rowTestID}>
      <PressHighlight
        style={styles.toggle}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={name}
        testID={toggleTestID}
      >
        <Chevron size={12} uniProps={mutedMapping} />
        {lead}
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count} testID={countTestID}>
          {count}
        </Text>
      </PressHighlight>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** One folder: its header row, then (when open) its rows. */
export function FolderBlockFrame({ testID, children }: { testID: string; children: ReactNode }) {
  return (
    <View style={styles.block} testID={testID}>
      {children}
    </View>
  );
}

/** The indented list under an open folder's header. */
export function FolderRowsFrame({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <View style={styles.rows} testID={testID}>
      {children}
    </View>
  );
}

/** A muted one-line note inside the Folders section. */
export function FolderHint({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <Text style={styles.hint} testID={testID}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    marginBottom: theme.spacing[0.5],
  },
  headerRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  nameSlot: { flex: 1, minWidth: 0 },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  rows: {
    paddingLeft: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    opacity: 0.8,
  },
}));

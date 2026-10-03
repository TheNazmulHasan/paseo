import { memo, useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardWorkspaceIdentity } from "@/boards/use-board-workspace-identity";
import { ProjectIconView } from "@/components/project-icon-view";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";

const ICON_SIZE = 14;

export interface BoardPaneStripEntry {
  paneId: string;
  /** Workspace of the pane's shown session; null for an empty pane. */
  identity: BoardWorkspaceIdentity | null;
}

interface BoardPaneStripProps {
  panes: BoardPaneStripEntry[];
  focusedPaneId: string | null;
  label: string;
  onFocusPane: (paneId: string) => void;
}

/**
 * Narrow-window companion to the one pane the board shows: every pane as a workspace chip,
 * always visible; a click switches which pane is on screen.
 */
export function BoardPaneStrip({ panes, focusedPaneId, label, onFocusPane }: BoardPaneStripProps) {
  return (
    <View style={styles.strip} accessibilityLabel={label} testID="board-pane-strip">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {panes.map((entry) => (
          <BoardPaneStripChip
            key={entry.paneId}
            entry={entry}
            active={entry.paneId === focusedPaneId}
            onFocusPane={onFocusPane}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const BoardPaneStripChip = memo(function BoardPaneStripChip({
  entry,
  active,
  onFocusPane,
}: {
  entry: BoardPaneStripEntry;
  active: boolean;
  onFocusPane: (paneId: string) => void;
}) {
  const { paneId, identity } = entry;
  const handlePress = useCallback(() => onFocusPane(paneId), [onFocusPane, paneId]);
  const name = identity?.workspaceName ?? "";
  return (
    <Pressable
      onPress={handlePress}
      style={active ? styles.chipActive : styles.chip}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={active ? SELECTED : UNSELECTED}
      testID={`board-pane-strip-${paneId}`}
    >
      {identity ? (
        <ProjectIconView
          iconDataUri={identity.iconDataUri}
          initial={identity.initial}
          projectViewKey={identity.projectViewKey}
          size={ICON_SIZE}
          textStyle={styles.iconText}
        />
      ) : null}
      <Text style={active ? styles.nameActive : styles.name} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
});

const SELECTED = { selected: true } as const;
const UNSELECTED = { selected: false } as const;

const styles = StyleSheet.create((theme) => {
  const chip = {
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  } as const;
  return {
    strip: {
      height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface0,
      justifyContent: "center",
    },
    content: {
      alignItems: "center",
      paddingHorizontal: theme.spacing[1],
      gap: theme.spacing[1],
    },
    chip: { ...chip },
    chipActive: { ...chip, backgroundColor: theme.colors.surface2 },
    name: {
      flexShrink: 1,
      minWidth: 0,
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    nameActive: {
      flexShrink: 1,
      minWidth: 0,
      color: theme.colors.foreground,
      fontSize: theme.fontSize.sm,
    },
    iconText: {
      fontSize: 9,
    },
  };
});

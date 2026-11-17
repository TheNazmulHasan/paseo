import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { countParts, type HomeCounts, type SessionState } from "./model";

const STATE_LABEL_KEYS = {
  needs_you: "homeMap.state.needsYou",
  your_move: "homeMap.state.yourMove",
  working: "homeMap.state.working",
  parked: "homeMap.state.parked",
} as const satisfies Record<SessionState, string>;

/**
 * The state dot: needs you (amber, as the sidebar's "wants something from you"), your move (green,
 * as its "finished"), working (blue), parked (a hollow ring: nothing to do).
 */
export const StateDot = memo(function StateDot({
  state,
  testID,
}: {
  state: SessionState;
  testID?: string;
}) {
  const { t } = useTranslation();
  const style = [styles.dot, dotStyleFor(state)];
  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(STATE_LABEL_KEYS[state])}
      testID={testID}
    />
  );
});

/** The last-activity age, kept current by its own small clock (see `useCompactTimeAgo`). */
export const ActivityAge = memo(function ActivityAge({ at }: { at: number }) {
  const date = useMemo(() => (at > 0 ? new Date(at) : null), [at]);
  const label = useCompactTimeAgo(date);
  return label ? <Text style={styles.age}>{label}</Text> : null;
});

/** "2 need you · 3 your move · 5 open" */
export const CountsLine = memo(function CountsLine({
  counts,
  testID,
}: {
  counts: HomeCounts;
  testID?: string;
}) {
  const { t } = useTranslation();
  const text = countParts(counts)
    .map((part) => t(`homeMap.counts.${part.kind}`, { count: part.count }))
    .join(" · ");
  return (
    <Text style={styles.counts} numberOfLines={1} testID={testID}>
      {text}
    </Text>
  );
});

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  dotNeedsYou: { backgroundColor: theme.colors.statusDotWarning },
  dotYourMove: { backgroundColor: theme.colors.statusDotSuccess },
  dotWorking: { backgroundColor: theme.colors.statusDotRunning },
  dotParked: {
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    opacity: 0.6,
  },
  age: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  counts: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
}));

function dotStyleFor(state: SessionState) {
  switch (state) {
    case "needs_you":
      return styles.dotNeedsYou;
    case "your_move":
      return styles.dotYourMove;
    case "working":
      return styles.dotWorking;
    default:
      return styles.dotParked;
  }
}

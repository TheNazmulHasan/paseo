import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SessionState } from "@getpaseo/protocol/session-state";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { dotKindFor } from "./view-model";

const STATE_LABEL_KEYS = {
  needs_you: "homeMap.state.needsYou",
  your_move: "homeMap.state.yourMove",
  working: "homeMap.state.working",
  stopped: "homeMap.state.stopped",
  parked: "homeMap.state.parked",
} as const satisfies Record<SessionState, string>;

export const StateDot = memo(function StateDot({
  state,
  waiting = false,
  testID,
}: {
  state: SessionState;
  /** The session waits on him (it is in the queue), whatever its raw state. */
  waiting?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const kind = dotKindFor(state, waiting);
  const label =
    kind === "waiting" && state !== "needs_you" ? "homeMap.state.waiting" : STATE_LABEL_KEYS[state];
  return (
    <View
      style={[
        styles.dot,
        kind === "waiting" ? styles.waiting : null,
        kind === "running" ? styles.running : null,
        kind === "ring" ? styles.ring : null,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(label)}
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

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  waiting: { backgroundColor: theme.colors.statusDotWarning },
  running: { backgroundColor: theme.colors.statusDotRunning },
  ring: {
    borderWidth: 1.5,
    borderColor: theme.colors.foregroundMuted,
    opacity: 0.6,
  },
  age: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));

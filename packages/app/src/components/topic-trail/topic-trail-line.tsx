import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { TopicTrailTopic } from "@getpaseo/protocol/topic-trail";

/** rank 0 = newest (bold, green dot), 1 = older, 2 = oldest. */
export type TopicRank = 0 | 1 | 2;

export function toTopicRank(index: number): TopicRank {
  if (index <= 0) return 0;
  return index === 1 ? 1 : 2;
}

/**
 * Nazmul mod (topic-trail): one topic label. With `onPress` it is an always-visible button (the
 * strip: click scrolls the chat to where the topic began); without it, plain text (the tab
 * tooltip).
 */
export const TopicTrailLine = memo(function TopicTrailLine({
  topic,
  rank,
  onPress,
}: {
  topic: TopicTrailTopic;
  rank: TopicRank;
  onPress?: (topic: TopicTrailTopic) => void;
}) {
  const { t } = useTranslation();
  const textStyle = [styles.label, rankLabelStyle(rank)];
  const handlePress = useCallback(() => onPress?.(topic), [onPress, topic]);
  const content = (
    <View style={styles.row}>
      {rank === 0 ? <View style={styles.dot} /> : null}
      <Text style={textStyle} numberOfLines={1} ellipsizeMode="tail">
        {topic.label}
      </Text>
    </View>
  );

  if (!onPress || topic.seq === null) {
    return <View style={styles.static}>{content}</View>;
  }
  return (
    <Pressable
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={t("topicTrail.jumpTo", { label: topic.label })}
      testID={`topic-trail-topic-${topic.seq}`}
    >
      {content}
    </Pressable>
  );
});

function rankLabelStyle(rank: TopicRank) {
  if (rank === 0) return styles.labelNewest;
  return rank === 1 ? styles.labelOlder : styles.labelOldest;
}

function pressableStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.button, hovered ? styles.buttonHovered : null];
}

export const YourMoveLine = memo(function YourMoveLine({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.moveLead}>{`↳ ${t("topicTrail.yourMove")}: `}</Text>
      <Text style={styles.moveText} numberOfLines={1} ellipsizeMode="tail">
        {text}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    flexShrink: 1,
  },
  static: {
    minWidth: 0,
    flexShrink: 1,
  },
  button: {
    minWidth: 0,
    flexShrink: 1,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[1],
    cursor: "pointer",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusSuccess,
    marginRight: theme.spacing[1.5],
  },
  label: {
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  labelNewest: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
  },
  labelOlder: {
    color: theme.colors.foregroundMuted,
  },
  labelOldest: {
    color: theme.colors.foregroundExtraMuted,
  },
  moveLead: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  moveText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusWarning,
    flexShrink: 1,
  },
}));

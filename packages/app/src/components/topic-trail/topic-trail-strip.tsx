import { memo, useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TopicTrail, TopicTrailTopic } from "@getpaseo/protocol/topic-trail";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useTopicTrailJumpStore } from "@/stores/topic-trail-jump-store";
import { formatCompactTimeAgoAsProse } from "@/utils/time";
import { TopicTrailLine, YourMoveLine, toTopicRank } from "./topic-trail-line";
import { selectVisibleYourMove, useIsAgentRunning, useTopicTrail } from "./topic-trail-model";

/**
 * Nazmul mod (topic-trail): a thin strip under a pane's tab row. Last 3 topics newest first,
 * time ago on the right, and an amber "Your move" line while the agent waits on the user.
 * Renders nothing when the active tab is not an agent or the agent has no trail yet.
 */
export function TopicTrailStrip({
  serverId,
  tab,
}: {
  serverId: string | null;
  tab: WorkspaceTabDescriptor | null;
}) {
  const agentId = tab?.target.kind === "agent" ? tab.target.agentId : null;
  const trail = useTopicTrail(serverId, agentId);
  if (!trail || !serverId || !agentId) {
    return null;
  }
  return <TopicTrailStripBody serverId={serverId} agentId={agentId} trail={trail} />;
}

const TopicTrailStripBody = memo(function TopicTrailStripBody({
  serverId,
  agentId,
  trail,
}: {
  serverId: string;
  agentId: string;
  trail: TopicTrail;
}) {
  const running = useIsAgentRunning(serverId, agentId);
  const yourMove = selectVisibleYourMove(trail, running);
  const ago = formatCompactTimeAgoAsProse(useCompactTimeAgo(new Date(trail.updatedAt)));

  const handlePress = useCallback(
    (topic: TopicTrailTopic) => {
      if (topic.seq === null) return;
      useTopicTrailJumpStore
        .getState()
        .requestJump({ serverId, agentId, seq: topic.seq, epoch: topic.epoch });
    },
    [agentId, serverId],
  );

  return (
    <View style={styles.container} testID={`topic-trail-strip-${agentId}`}>
      <View style={styles.topics}>
        {trail.topics.map((topic, index) => (
          <View key={`${topic.seq ?? "x"}-${topic.label}`} style={styles.topicSlot}>
            {index > 0 ? <Text style={styles.separator}>‹</Text> : null}
            <TopicTrailLine topic={topic} rank={toTopicRank(index)} onPress={handlePress} />
          </View>
        ))}
        {ago ? <Text style={styles.ago}>{ago}</Text> : null}
      </View>
      {yourMove ? <YourMoveLine text={yourMove} /> : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    minHeight: 22,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[0.5],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    minWidth: 0,
  },
  topics: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  topicSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  separator: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  ago: {
    marginLeft: "auto",
    paddingLeft: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
    flexShrink: 0,
  },
}));

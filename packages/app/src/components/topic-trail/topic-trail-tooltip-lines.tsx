import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TopicTrailLine, YourMoveLine, toTopicRank } from "./topic-trail-line";
import { selectVisibleYourMove, useIsAgentRunning, useTopicTrail } from "./topic-trail-model";

/** Nazmul mod (topic-trail): the trail as a vertical list inside the agent tab's hover card. */
export function TopicTrailTooltipLines({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}) {
  const trail = useTopicTrail(serverId, agentId);
  const running = useIsAgentRunning(serverId, agentId);
  if (!trail) {
    return null;
  }
  const yourMove = selectVisibleYourMove(trail, running);
  return (
    <View style={styles.container} testID={`topic-trail-tooltip-${agentId}`}>
      {trail.topics.map((topic, index) => (
        <TopicTrailLine
          key={`${topic.seq ?? "x"}-${topic.label}`}
          topic={topic}
          rank={toTopicRank(index)}
        />
      ))}
      {yourMove ? <YourMoveLine text={yourMove} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[0.5],
    marginTop: theme.spacing[1],
  },
}));

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useCopyAgentId } from "@/hooks/use-agent-tab-actions";
import { useSessionStore } from "@/stores/session-store";
import { formatCompactTimeAgoAsProse } from "@/utils/time";

const COPIED_FEEDBACK_MS = 1200;

/**
 * The hover card of an agent tab (workspace tabs and Views tabs): title, short id, last activity.
 * Clicking the short id copies the FULL agent id. The card only holds the pointer when its
 * Tooltip is `interactive`.
 */
export function AgentTabTooltipBody({
  serverId,
  agentId,
  title,
}: {
  serverId: string;
  agentId: string;
  title: string;
}) {
  const { t } = useTranslation();
  const copyAgentId = useCopyAgentId();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAt = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
    return state.agentLastActivity.get(agentId) ?? agent?.lastActivityAt ?? null;
  });
  const compactActivity = useCompactTimeAgo(lastActivityAt);
  const activity = formatCompactTimeAgoAsProse(compactActivity);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(() => {
    void copyAgentId(agentId);
    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  }, [agentId, copyAgentId]);

  const idStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.agentIdButton,
      hovered ? styles.agentIdButtonHovered : null,
    ],
    [],
  );

  return (
    <View style={styles.content}>
      <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>
      <View style={styles.metadata}>
        <Pressable
          onPress={handleCopy}
          style={idStyle}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.tabs.menu.copyAgentId")}
          testID={`agent-tab-tooltip-copy-id-${agentId}`}
        >
          <Text style={copied ? styles.copiedText : styles.agentId}>
            {copied ? t("common.states.copied") : agentId.slice(0, 7)}
          </Text>
        </Pressable>
        {activity ? (
          <>
            <Text style={styles.separator}>·</Text>
            <Text style={styles.activity}>{activity}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[0.5],
    maxWidth: 420,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  metadata: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  agentIdButton: {
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
    marginLeft: -theme.spacing[1],
  },
  agentIdButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  agentId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
  },
  copiedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  activity: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

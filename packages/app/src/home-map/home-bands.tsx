import { memo, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { openHomeSession } from "./open-session";
import type { HomeSession } from "./model";
import { ActivityAge, StateDot } from "./state-dot";

/** A band shows this many rows until "Show more": the picture first, the long tail on request. */
export const BAND_ROW_LIMIT = 6;

function sessionLabel(session: HomeSession, untitled: string): string {
  return session.title ?? untitled;
}

function contextLine(session: HomeSession): string | null {
  const parts = [session.folderName, session.workspaceName].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length > 0 ? parts.join(" › ") : null;
}

/** One session in a band: dot, title, age; then its "Your move" line; then where it lives. */
const BandRow = memo(function BandRow({
  session,
  compact,
  showYourMove,
}: {
  session: HomeSession;
  compact: boolean;
  showYourMove: boolean;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (!session.workspaceId) return;
    openHomeSession({
      serverId: session.serverId,
      workspaceId: session.workspaceId,
      agentId: session.agentId,
    });
  }, [session.agentId, session.serverId, session.workspaceId]);
  const title = sessionLabel(session, t("homeMap.map.untitled"));
  const where = contextLine(session);
  return (
    <PressHighlight
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={`home-band-row-${session.key}`}
    >
      <View style={styles.rowTop}>
        <StateDot state={session.state} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {compact && where ? (
          <Text style={styles.where} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
        <ActivityAge at={session.lastActivityAt} />
      </View>
      {showYourMove && session.yourMoveText ? (
        <Text style={styles.yourMove} numberOfLines={2} testID={`home-your-move-${session.key}`}>
          {session.yourMoveText}
        </Text>
      ) : null}
      {!compact && where ? (
        <Text style={styles.whereBelow} numberOfLines={1}>
          {where}
        </Text>
      ) : null}
    </PressHighlight>
  );
});

/**
 * A band of sessions in one state. The header says the state and how many; the rows open the
 * session on press. An empty band says so (the answer "nothing needs you" is information), unless
 * `hideWhenEmpty`.
 */
export const HomeBand = memo(function HomeBand({
  title,
  emptyText,
  sessions,
  compact = false,
  showYourMove = false,
  hideWhenEmpty = false,
  inRow = false,
  testID,
}: {
  title: string;
  emptyText: string;
  sessions: readonly HomeSession[];
  compact?: boolean;
  showYourMove?: boolean;
  hideWhenEmpty?: boolean;
  /** The band sits in a wrapping row with its siblings. */
  inRow?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  if (sessions.length === 0 && hideWhenEmpty) return null;
  const overflow = sessions.length - BAND_ROW_LIMIT;
  const visible = expanded || overflow <= 0 ? sessions : sessions.slice(0, BAND_ROW_LIMIT);
  const first = sessions[0];
  return (
    <View style={inRow ? [styles.band, styles.bandInRow] : styles.band} testID={testID}>
      <View style={styles.header}>
        {first ? <StateDot state={first.state} /> : null}
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerCount} testID={`${testID}-count`}>
          {sessions.length}
        </Text>
      </View>
      {sessions.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        visible.map((session) => (
          <BandRow
            key={session.key}
            session={session}
            compact={compact}
            showYourMove={showYourMove}
          />
        ))
      )}
      {overflow > 0 ? (
        <View style={styles.more}>
          <Button variant="ghost" size="sm" onPress={toggleExpanded} testID={`${testID}-more`}>
            {expanded
              ? t("homeMap.bands.showLess")
              : t("homeMap.bands.showMore", { count: overflow })}
          </Button>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  band: {
    minWidth: 0,
    gap: theme.spacing[1],
  },
  // In a wrapping row: side by side while each gets 320, stacked when the window is narrower.
  bandInRow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 320,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  headerCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  row: {
    gap: 2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  yourMove: {
    paddingLeft: theme.spacing[4],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  where: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  whereBelow: {
    paddingLeft: theme.spacing[4],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  more: {
    alignItems: "flex-start",
    paddingHorizontal: theme.spacing[1],
  },
}));

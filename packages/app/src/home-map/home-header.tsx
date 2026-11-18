import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { HomeTally } from "@getpaseo/protocol/home";
import { HomeButton } from "./home-button";
import { computeTallyBar, fallbackHeadline, formatClock } from "./view-model";

const FALLBACK_HEADLINE_KEYS = {
  empty: "homeMap.headline.empty",
  clear: "homeMap.headline.clear",
  waiting: "homeMap.headline.waiting",
} as const;

/** "Wednesday 18 November · 08:32", in the app's language. */
function useDateLine(now: number): string {
  return useMemo(() => {
    const date = new Date(now);
    const day = date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return `${day} · ${formatClock(date.toISOString())}`;
  }, [now]);
}

/**
 * The top of Home: the date, when the brief was last made (with a visible Refresh), Haiku's
 * headline (or a plain sentence from the tally while there is no brief), the "since" line, the
 * tally and its thin bar. The tally says out loud when the groups hold fewer sessions than are
 * open ("N not placed"): Home never hides one.
 */
export const HomeHeader = memo(function HomeHeader({
  now,
  headline,
  since,
  generatedAt,
  briefRunning,
  tally,
  closedToday,
  refreshing,
  onRefresh,
}: {
  now: number;
  headline: string | null;
  since: string | null;
  generatedAt: string | null;
  briefRunning: boolean;
  tally: HomeTally;
  closedToday: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const dateLine = useDateLine(now);
  const updatedAt = formatClock(generatedAt);
  const fallback = fallbackHeadline(tally);
  const bar = computeTallyBar(tally);
  const headlineText = headline?.trim()
    ? headline.trim()
    : t(FALLBACK_HEADLINE_KEYS[fallback.key], { count: fallback.count });

  return (
    <View style={styles.container} testID="home-header">
      <View style={styles.top}>
        <Text style={styles.date}>{dateLine}</Text>
        <View style={styles.refreshWrap}>
          <Text style={styles.updated} testID="home-updated">
            {updatedAt
              ? t("homeMap.header.updated", { time: updatedAt })
              : t("homeMap.header.notUpdated")}
          </Text>
          {briefRunning ? (
            <Text style={styles.updated} testID="home-brief-running">
              {t("homeMap.header.reading")}
            </Text>
          ) : null}
          <HomeButton
            kind="plain"
            onPress={onRefresh}
            loading={refreshing}
            testID="home-refresh"
            accessibilityLabel={t("homeMap.header.refresh")}
          >
            {t("homeMap.header.refresh")}
          </HomeButton>
        </View>
      </View>
      <Text style={styles.headline} testID="home-headline">
        {headlineText}
      </Text>
      {since?.trim() ? <Text style={styles.since}>{since.trim()}</Text> : null}
      <Text style={styles.tally} testID="home-tally">
        <Text style={styles.tallyStrong}>{t("homeMap.tally.open", { count: tally.open })}</Text>
        {` · ${t("homeMap.tally.waiting", { count: tally.waiting })}`}
        {` · ${t("homeMap.tally.running", { count: tally.running })}`}
        {` · ${t("homeMap.tally.stopped", { count: tally.stopped })}`}
        {` · ${t("homeMap.tally.toCheck", { count: tally.toCheck })}`}
        {" · "}
        <Text style={styles.tallyStrong}>
          {t("homeMap.tally.closedToday", { count: closedToday })}
        </Text>
        {tally.gap > 0 ? (
          <Text style={styles.gap} testID="home-gap">
            {` · ${t("homeMap.tally.notPlaced", { count: tally.gap })}`}
          </Text>
        ) : null}
      </Text>
      <View style={styles.bar}>
        <View style={[styles.barPart, styles.barWaiting, { width: `${bar.waiting}%` }]} />
        <View style={[styles.barPart, styles.barRunning, { width: `${bar.running}%` }]} />
        <View style={[styles.barPart, styles.barRest, { width: `${bar.rest}%` }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 2,
    minWidth: 0,
  },
  top: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  date: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  refreshWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  updated: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  headline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    marginTop: 2,
  },
  since: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tally: {
    marginTop: theme.spacing[1.5],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tallyStrong: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
  },
  gap: {
    color: theme.colors.statusDotWarning,
    fontWeight: theme.fontWeight.semibold,
  },
  bar: {
    flexDirection: "row",
    height: 6,
    maxWidth: 520,
    marginTop: theme.spacing[1.5],
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  barPart: {
    height: "100%",
  },
  barWaiting: { backgroundColor: theme.colors.statusDotWarning },
  barRunning: { backgroundColor: theme.colors.statusDotRunning },
  barRest: { backgroundColor: theme.colors.surface3 },
}));

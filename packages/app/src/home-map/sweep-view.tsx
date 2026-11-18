import { memo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { HomeButton } from "./home-button";
import { sessionLocation } from "./model";
import { ActivityAge } from "./state-dot";
import { describeItem, type HomeSessionEntry } from "./view-model";

/**
 * Sweep: the "Check on these" list one session at a time, inbox-zero style. The card shows what
 * the session is about, where it stands, why, and what is still open; Keep hides it for a week,
 * Close archives it (Undo for 10 s), Open goes there. "3 of 39" says how far along it is. Esc
 * leaves. Finishing says "Nothing left to check".
 */
export const SweepView = memo(function SweepView({
  entry,
  position,
  total,
  onKeep,
  onClose,
  onOpen,
  onExit,
}: {
  /** The session to look at, or null when the list is finished. */
  entry: HomeSessionEntry | null;
  position: number;
  total: number;
  onKeep: () => void;
  onClose: () => void;
  onOpen: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const card = entry?.session.card ?? null;
  const text = entry ? describeItem(entry, { withNextStep: false, withWhy: true }) : null;
  const location = entry ? sessionLocation(entry.session) : null;
  return (
    <View style={styles.container} testID="home-sweep">
      <View style={styles.header}>
        <Text style={styles.title}>{t("homeMap.sweep.title")}</Text>
        {entry ? (
          <Text style={styles.progress} testID="home-sweep-progress">
            {t("homeMap.sweep.progress", { position, total })}
          </Text>
        ) : null}
        <View style={styles.spacer} />
        <HomeButton kind="plain" onPress={onExit} testID="home-sweep-exit">
          {t("homeMap.sweep.exit")}
        </HomeButton>
      </View>

      {entry && text ? (
        <View style={styles.card} testID={`home-sweep-card-${entry.session.id}`}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{text.name}</Text>
            <ActivityAge at={entry.session.lastActivityAt} />
          </View>
          {location ? <Text style={styles.location}>{location}</Text> : null}
          {entry.reading ? <Text style={styles.dim}>{t("homeMap.reading")}</Text> : null}
          {card?.what && card.what.trim().toLowerCase() !== text.name.toLowerCase() ? (
            <Text style={styles.body}>{card.what}</Text>
          ) : null}
          {text.status ? <Text style={styles.body}>{text.status}</Text> : null}
          {card?.looksFinished ? (
            <Text style={styles.dim}>{t("homeMap.checkOn.looksFinished")}</Text>
          ) : null}
          {text.why ? <Text style={styles.dim}>{text.why}</Text> : null}
          {card && card.openItems.length > 0 ? (
            <View style={styles.openItems}>
              <Text style={styles.dim}>{t("homeMap.sweep.openItems")}</Text>
              {card.openItems.map((item) => (
                <Text key={item} style={styles.body}>
                  {`• ${item}`}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.actions}>
            <HomeButton kind="plain" onPress={onKeep} testID="home-sweep-keep">
              {t("homeMap.sweep.keep")}
            </HomeButton>
            <HomeButton kind="plain" onPress={onClose} testID="home-sweep-close">
              {t("homeMap.queue.close")}
            </HomeButton>
            <HomeButton kind="go" onPress={onOpen} testID="home-sweep-open">
              {t("homeMap.queue.open")}
            </HomeButton>
          </View>
          <Text style={styles.hint}>{t("homeMap.sweep.hint")}</Text>
        </View>
      ) : (
        <View style={styles.card} testID="home-sweep-done">
          <Text style={styles.name}>{t("homeMap.sweep.done")}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  progress: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  spacer: { flexGrow: 1 },
  card: {
    gap: theme.spacing[1.5],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  name: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  location: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  dim: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  openItems: {
    gap: 2,
    marginTop: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    marginTop: theme.spacing[1],
  },
}));

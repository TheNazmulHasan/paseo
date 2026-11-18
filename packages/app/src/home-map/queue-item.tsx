import { memo, useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { HomeSnoozePreset } from "@getpaseo/protocol/home";
import { PressHighlight } from "@/components/ui/press-highlight";
import { HomeButton } from "./home-button";
import { LaterMenu } from "./later-menu";
import { sessionLocation, type HomeSession } from "./model";
import { ActivityAge } from "./state-dot";
import { describeItem, type QueueItemModel } from "./view-model";

/**
 * One thing waiting on him. Name (bold), then the step he must take, where it stands, why it is
 * urgent, `Folder › Workspace`, and the always-visible buttons: Open (green), Later ▾, Close. The
 * whole item opens the session too. A Chief layout item has only Open and its own one-line note.
 */
export const QueueItem = memo(function QueueItem({
  item,
  hasActions,
  focused,
  laterOpen,
  onLaterOpenChange,
  onOpen,
  onClose,
  onSnooze,
}: {
  item: QueueItemModel;
  hasActions: boolean;
  focused: boolean;
  laterOpen: boolean;
  onLaterOpenChange: (sessionId: string, open: boolean) => void;
  onOpen: (session: HomeSession) => void;
  onClose: (session: HomeSession) => void;
  onSnooze: (session: HomeSession, preset: HomeSnoozePreset) => void;
}) {
  const { t } = useTranslation();
  const { entry } = item;
  const session = entry.session;
  const text = describeItem(entry, {
    withNextStep: true,
    withWhy: true,
    layoutLine: item.line,
  });
  const location = sessionLocation(session);

  const handleOpen = useCallback(() => onOpen(session), [onOpen, session]);
  const handleClose = useCallback(() => onClose(session), [onClose, session]);
  const handleSnooze = useCallback(
    (preset: HomeSnoozePreset) => onSnooze(session, preset),
    [onSnooze, session],
  );
  const handleLaterOpenChange = useCallback(
    (open: boolean) => onLaterOpenChange(session.id, open),
    [onLaterOpenChange, session.id],
  );

  return (
    <PressHighlight
      style={focused ? [styles.item, styles.itemFocused] : styles.item}
      onPress={handleOpen}
      accessibilityRole="button"
      accessibilityLabel={text.name}
      testID={`home-queue-item-${session.id}`}
    >
      <Text style={styles.number}>{item.number}</Text>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {text.name}
        </Text>
        {entry.reading ? (
          <Text style={styles.dim} testID={`home-reading-${session.id}`}>
            {t("homeMap.reading")}
          </Text>
        ) : null}
        {text.nextStep ? <Text style={styles.nextStep}>{text.nextStep}</Text> : null}
        {text.status ? <Text style={styles.dim}>{text.status}</Text> : null}
        {text.why ? <Text style={styles.why}>{text.why}</Text> : null}
        {location ? (
          <Text style={styles.location} numberOfLines={1}>
            {location}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <HomeButton kind="go" onPress={handleOpen} testID={`home-open-${session.id}`}>
            {t("homeMap.queue.open")}
          </HomeButton>
          {hasActions ? (
            <>
              <LaterMenu
                open={laterOpen}
                onOpenChange={handleLaterOpenChange}
                onSelect={handleSnooze}
                testID={`home-later-${session.id}`}
              />
              <HomeButton kind="quiet" onPress={handleClose} testID={`home-close-${session.id}`}>
                {t("homeMap.queue.close")}
              </HomeButton>
            </>
          ) : null}
        </View>
      </View>
      <ActivityAge at={session.lastActivityAt} />
    </PressHighlight>
  );
});

const styles = StyleSheet.create((theme) => ({
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    minWidth: 0,
  },
  itemFocused: {
    borderColor: theme.colors.borderAccent,
  },
  number: {
    width: 20,
    textAlign: "right",
    paddingTop: 2,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  nextStep: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  dim: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  why: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  location: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
    marginTop: theme.spacing[1],
  },
}));

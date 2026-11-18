import { memo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AssistantMessage } from "@/components/message";
import { ScrollView } from "@/components/ui/scroll-view";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Agent } from "@/stores/session-store";
import { useChiefReply } from "./chief-bar";
import { HomeButton } from "./home-button";

/**
 * Chief's full reply, as markdown, in a drawer over the right column (the whole body on a narrow
 * window). Esc closes it. Reading only: the conversation stays in Chief's own workspace.
 */
export const ChiefDrawer = memo(function ChiefDrawer({
  chief,
  onClose,
}: {
  chief: Agent;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reply = useChiefReply(chief);
  const client = useHostRuntimeClient(chief.serverId);
  const running = chief.status === "running";
  return (
    <View style={styles.drawer} testID="home-chief-drawer">
      <View style={styles.header}>
        <Text style={styles.title}>{t("homeMap.chief.drawerTitle")}</Text>
        <HomeButton kind="plain" onPress={onClose} testID="home-chief-drawer-close">
          {t("homeMap.chief.close")}
        </HomeButton>
      </View>
      <ScrollView style={styles.scroll} testID="home-chief-drawer-scroll">
        {reply ? (
          <AssistantMessage
            renderFullContent
            occurrenceKey={`home-chief-drawer-${chief.id}`}
            message={reply}
            timestamp={chief.lastActivityAt.getTime()}
            serverId={chief.serverId}
            client={client}
            spacing="compactBoth"
            phase={running ? "streaming" : "complete"}
          />
        ) : (
          <Text style={styles.empty}>{t("homeMap.chief.noReply")}</Text>
        )}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  drawer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "46%",
    minWidth: 320,
    maxWidth: "100%",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    zIndex: 5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

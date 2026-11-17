import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Bot, ExternalLink as OpenIcon, Send } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AssistantMessage } from "@/components/message";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useToast } from "@/contexts/toast-api-context";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { selectLatestAssistantText } from "./model";
import { openHomeSession } from "./open-session";

const ThemedBot = withUnistyles(Bot);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** What the Chief box shows when no agent carries the Chief label. It never creates the agent. */
function ChiefSetupHint() {
  const { t } = useTranslation();
  return (
    <View style={styles.box} testID="home-chief-setup">
      <View style={styles.headerRow}>
        <ThemedBot size={16} uniProps={mutedMapping} />
        <Text style={styles.title}>{t("homeMap.chief.setup")}</Text>
      </View>
      <Text style={styles.hint}>{t("homeMap.chief.setupHint")}</Text>
    </View>
  );
}

const ChiefInput = memo(function ChiefInput({ chief }: { chief: Agent }) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(chief.serverId);
  const isConnected = useHostRuntimeIsConnected(chief.serverId);
  const { ensureAgentIsInitialized } = useAgentInitialization({ serverId: chief.serverId, client });
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // The latest reply comes from the agent's stream, which is only loaded once the agent has been
  // opened (or fetched). Fetch it once per Chief agent; after that the live stream keeps it current.
  const chiefId = chief.id;
  useEffect(() => {
    if (!client) return;
    ensureAgentIsInitialized(chiefId).catch(() => undefined);
  }, [chiefId, client, ensureAgentIsInitialized]);

  const reply = useSessionStore((state) => {
    const session = state.sessions[chief.serverId];
    return selectLatestAssistantText(
      session?.agentStreamHead.get(chiefId),
      session?.agentStreamTail.get(chiefId),
    );
  });
  const running = chief.status === "running";
  const canSend = text.trim().length > 0 && !sending && isConnected && client !== null;

  const handleSend = useCallback(async () => {
    const message = text.trim();
    if (!message || !client || sending) return;
    setSending(true);
    try {
      await client.sendAgentMessage(chiefId, message);
      inputRef.current?.reset();
      setText("");
    } catch (error) {
      toast.error(`${t("homeMap.chief.sendFailed")}: ${toErrorMessage(error)}`);
    } finally {
      setSending(false);
    }
  }, [chiefId, client, sending, t, text, toast]);

  const handleOpenChief = useCallback(() => {
    if (!chief.workspaceId) return;
    openHomeSession({
      serverId: chief.serverId,
      workspaceId: chief.workspaceId,
      agentId: chiefId,
    });
  }, [chief.serverId, chief.workspaceId, chiefId]);

  return (
    <View style={styles.box} testID="home-chief">
      <View style={styles.headerRow}>
        <ThemedBot size={16} uniProps={mutedMapping} />
        <Text style={styles.title}>{t("homeMap.chief.title")}</Text>
        {running ? <Text style={styles.status}>{t("homeMap.chief.thinking")}</Text> : null}
        <View style={styles.spacer} />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={OpenIcon}
          onPress={handleOpenChief}
          disabled={!chief.workspaceId}
          testID="home-chief-open"
        >
          {t("homeMap.chief.open")}
        </Button>
      </View>
      {reply ? (
        <ScrollView style={styles.reply} testID="home-chief-reply" nestedScrollEnabled>
          <AssistantMessage
            renderFullContent
            occurrenceKey={`home-chief-${chiefId}`}
            message={reply}
            timestamp={chief.lastActivityAt.getTime()}
            serverId={chief.serverId}
            client={client}
            spacing="compactBoth"
            phase={running ? "streaming" : "complete"}
          />
        </ScrollView>
      ) : (
        <Text style={styles.hint} testID="home-chief-no-reply">
          {t("homeMap.chief.noReply")}
        </Text>
      )}
      <View style={styles.inputRow}>
        <View style={styles.field}>
          <ThemedTextInput
            ref={inputRef}
            testID="home-chief-input"
            onChangeText={setText}
            onSubmitEditing={handleSend}
            placeholder={t("homeMap.chief.placeholder")}
            accessibilityLabel={t("homeMap.chief.placeholder")}
            returnKeyType="send"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <Button
          variant="default"
          size="sm"
          leftIcon={Send}
          onPress={handleSend}
          disabled={!canSend}
          loading={sending}
          testID="home-chief-send"
        >
          {t("homeMap.chief.send")}
        </Button>
      </View>
    </View>
  );
});

/**
 * Nazmul mod (home-map): the Chief box at the bottom of Home. A single-line input sends the text as
 * a prompt to the Chief agent and the latest reply shows above it as markdown (its links open the
 * workspace or session in place, like chat links). With no Chief agent it only explains how to set
 * one up: Home never creates agents.
 */
export function ChiefBox({ chief }: { chief: Agent | null }) {
  return chief ? <ChiefInput chief={chief} /> : <ChiefSetupHint />;
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  spacer: {
    flexGrow: 1,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  reply: {
    maxHeight: 180,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  field: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  input: {
    padding: 0,
    height: 20,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

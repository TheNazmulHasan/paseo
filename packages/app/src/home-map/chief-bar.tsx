import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Bot, ExternalLink as OpenIcon, Send } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useToast } from "@/contexts/toast-api-context";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { HomeButton } from "./home-button";
import { selectLatestAssistantText } from "./model";
import { openHomeSession } from "./open-session";
import { clipReplyLine } from "./view-model";

const ThemedBot = withUnistyles(Bot);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Chief's newest reply (markdown). The text lives in the agent's stream, which is only loaded
 * once the agent has been opened (or fetched), so it is fetched once per Chief agent; after that
 * the live stream keeps it current.
 */
export function useChiefReply(chief: Agent): string | null {
  const serverId = chief.serverId;
  const chiefId = chief.id;
  const client = useHostRuntimeClient(serverId);
  const { ensureAgentIsInitialized } = useAgentInitialization({ serverId, client });
  useEffect(() => {
    if (!client) return;
    ensureAgentIsInitialized(chiefId).catch(() => undefined);
  }, [chiefId, client, ensureAgentIsInitialized]);
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    return selectLatestAssistantText(
      session?.agentStreamHead.get(chiefId),
      session?.agentStreamTail.get(chiefId),
    );
  });
}

/** What the bar shows when no agent carries the Chief label. Home never creates the agent. */
function ChiefSetupHint() {
  const { t } = useTranslation();
  return (
    <View style={styles.bar} testID="home-chief-setup">
      <View style={styles.hintRow}>
        <ThemedBot size={16} uniProps={mutedMapping} />
        <Text style={styles.hintTitle}>{t("homeMap.chief.setup")}</Text>
      </View>
      <Text style={styles.hint}>{t("homeMap.chief.setupHint")}</Text>
    </View>
  );
}

/** One line: "Chief, 2m ago: <first line of the reply>" and Read (opens the side drawer). */
const ReplyLine = memo(function ReplyLine({
  chief,
  reply,
  onRead,
}: {
  chief: Agent;
  reply: string | null;
  onRead: () => void;
}) {
  const { t } = useTranslation();
  const at = useMemo(() => chief.lastActivityAt, [chief.lastActivityAt]);
  const ago = useTimeAgo(at);
  const line = clipReplyLine(reply);
  const running = chief.status === "running";
  if (!line) {
    return (
      <Text style={styles.hint} testID="home-chief-no-reply">
        {running ? t("homeMap.chief.thinking") : t("homeMap.chief.noReply")}
      </Text>
    );
  }
  return (
    <View style={styles.replyRow} testID="home-chief-reply">
      <Text style={styles.replyText} numberOfLines={1}>
        <Text style={styles.replyFrom}>{t("homeMap.chief.replyFrom", { ago })} </Text>
        {line}
      </Text>
      {running ? <Text style={styles.hint}>{t("homeMap.chief.thinking")}</Text> : null}
      <HomeButton kind="quiet" onPress={onRead} testID="home-chief-read">
        {t("homeMap.chief.read")}
      </HomeButton>
    </View>
  );
});

/**
 * Nazmul mod (home-map): the Chief bar at the bottom of Home. SEND-ONLY: one input, Send and Open
 * Chief. Send puts the text in Chief's chat, clears the box and leaves you on Home; there is no
 * conversation here. Under it, one line with Chief's latest reply and Read (side drawer). With no
 * Chief agent it only explains how to set one up: Home never creates agents.
 */
export const ChiefBar = memo(function ChiefBar({
  chief,
  onRead,
}: {
  chief: Agent | null;
  onRead: () => void;
}) {
  return chief ? <ChiefInput chief={chief} onRead={onRead} /> : <ChiefSetupHint />;
});

const ChiefInput = memo(function ChiefInput({
  chief,
  onRead,
}: {
  chief: Agent;
  onRead: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(chief.serverId);
  const isConnected = useHostRuntimeIsConnected(chief.serverId);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const reply = useChiefReply(chief);
  const chiefId = chief.id;
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
    openHomeSession({ serverId: chief.serverId, workspaceId: chief.workspaceId, agentId: chiefId });
  }, [chief.serverId, chief.workspaceId, chiefId]);

  return (
    <View style={styles.bar} testID="home-chief">
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
        <Button
          variant="secondary"
          size="sm"
          leftIcon={OpenIcon}
          onPress={handleOpenChief}
          disabled={!chief.workspaceId}
          testID="home-chief-open"
        >
          {t("homeMap.chief.open")}
        </Button>
      </View>
      <ReplyLine chief={chief} reply={reply} onRead={onRead} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  bar: {
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1.5],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hintTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
  replyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  replyText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  replyFrom: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
}));

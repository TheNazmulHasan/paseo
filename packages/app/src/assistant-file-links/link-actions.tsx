import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useOptionalAssistantFileLinkResolverContext } from "./provider";
import { useRevealInFileManager } from "./use-reveal-in-file-manager";

export type AssistantLinkActionId = "open" | "reveal" | "copy";

export interface AssistantLinkAction {
  id: AssistantLinkActionId;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export interface AssistantLinkActionsInput {
  /** Set when the link opens in the browser. */
  externalUrl: string | null;
  /** Set when the link resolved to a local file or folder. */
  filePath: string | null;
  /** What "Copy" puts on the clipboard when neither of the above is known yet. */
  fallbackCopyText: string;
  /** The link's normal click action (browser for URLs, the workspace viewer for files). */
  onOpen?: () => void;
  /**
   * For a link whose file is not known yet (a bare "menu.tsx" the daemon has to find):
   * resolves to the absolute path on demand. Lets Reveal and Copy appear before the lookup.
   */
  resolveFilePath?: () => Promise<string | null>;
}

/**
 * The action set for one link or path in a reply: Open (link / file), Reveal in Finder
 * (paths, desktop + local daemon only) and Copy (link / path). Shared by the inline icon row
 * and the right-click menu so the two can never disagree.
 */
export function useAssistantLinkActions({
  externalUrl,
  filePath,
  fallbackCopyText,
  onOpen,
  resolveFilePath,
}: AssistantLinkActionsInput): AssistantLinkAction[] {
  const { t } = useTranslation();
  const context = useOptionalAssistantFileLinkResolverContext();
  const revealInFileManager = useRevealInFileManager();

  const isLink = externalUrl !== null;
  const canResolveFile = !isLink && (filePath !== null || resolveFilePath !== undefined);
  const copyText = externalUrl ?? filePath ?? fallbackCopyText;
  const handleCopy = useStableEvent(() => {
    void (async () => {
      const resolved = !isLink && !filePath && resolveFilePath ? await resolveFilePath() : null;
      const text = resolved ?? copyText;
      if (!text) return;
      await Clipboard.setStringAsync(text);
      context?.configRef.current.toast?.copied();
    })();
  });
  const handleReveal = useStableEvent(() => {
    void (async () => {
      const path = filePath ?? (await resolveFilePath?.()) ?? null;
      if (path) revealInFileManager?.reveal(path);
    })();
  });

  return useMemo<AssistantLinkAction[]>(() => {
    const specs: Array<AssistantLinkAction | null> = [
      onOpen
        ? {
            id: "open",
            label: isLink ? t("message.actions.openLink") : t("workspace.fileActions.openFile"),
            icon: isLink ? ExternalLink : FileText,
            onSelect: onOpen,
          }
        : null,
      canResolveFile && revealInFileManager
        ? {
            id: "reveal",
            label: t("workspace.fileActions.revealIn", {
              target: revealInFileManager.targetName,
            }),
            icon: FolderOpen,
            onSelect: handleReveal,
          }
        : null,
      copyText
        ? {
            id: "copy",
            label: isLink ? t("message.actions.copyLink") : t("workspace.fileActions.copyPath"),
            icon: Copy,
            onSelect: handleCopy,
          }
        : null,
    ];
    return specs.filter((spec): spec is AssistantLinkAction => spec !== null);
  }, [canResolveFile, copyText, handleCopy, handleReveal, isLink, onOpen, revealInFileManager, t]);
}

interface AssistantLinkInlineActionsProps extends AssistantLinkActionsInput {
  /** Icon size in px: 12 sits inside a line of text, 14 matches a code block's Copy button. */
  size?: number;
  /** Inline follows the chip in the text flow; block is a plain row for a code block corner. */
  layout?: "inline" | "block";
}

const COPIED_RESET_MS = 1500;

/**
 * The always-visible icon row after a link or path: Open · Reveal in Finder · Copy. Nazmul
 * asked for these to be in sight rather than behind a right-click.
 */
export function AssistantLinkInlineActions({
  size = 12,
  layout = "inline",
  ...input
}: AssistantLinkInlineActionsProps): ReactElement | null {
  const { t } = useTranslation();
  const actions = useAssistantLinkActions(input);
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );
  const flashCopied = useCallback(() => {
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, []);

  // A chip is already clickable, so an Open icon next to it would repeat what the click does.
  // A code block's text is not clickable, so there the Open icon earns its place.
  const visibleActions = useMemo(
    () => (layout === "inline" ? actions.filter((action) => action.id !== "open") : actions),
    [actions, layout],
  );

  if (visibleActions.length === 0) {
    return null;
  }
  return (
    <View
      style={layout === "inline" ? INLINE_ROW_STYLE : styles.blockRow}
      dataSet={markdownCopyDataSet.ignore}
    >
      {visibleActions.map((action) => (
        <AssistantLinkActionButton
          key={action.id}
          action={action}
          size={size}
          label={action.id === "copy" && copied ? t("message.actions.copied") : action.label}
          icon={action.id === "copy" && copied ? Check : action.icon}
          onAfterSelect={action.id === "copy" ? flashCopied : undefined}
        />
      ))}
    </View>
  );
}

interface AssistantLinkActionButtonProps {
  action: AssistantLinkAction;
  size: number;
  label: string;
  icon: LucideIcon;
  onAfterSelect?: () => void;
}

function AssistantLinkActionButton({
  action,
  size,
  label,
  icon: Icon,
  onAfterSelect,
}: AssistantLinkActionButtonProps): ReactElement {
  const handlePress = useCallback(() => {
    action.onSelect();
    onAfterSelect?.();
  }, [action, onAfterSelect]);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={4}
        style={styles.button}
      >
        {({ hovered }) => (
          <Icon
            size={size}
            color={hovered ? styles.iconHoveredColor.color : styles.iconColor.color}
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <Text selectable={false} style={styles.tooltipText}>
          {label}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

// RN doesn't type "inline-flex" / "verticalAlign" on a View, but RN-web honors both, which keeps
// the row inside the line of text instead of breaking onto its own line. Kept out of the
// unistyles sheet: an untyped key there widens every style in the sheet.
const INLINE_ROW_WEB_STYLE = {
  display: "inline-flex",
  verticalAlign: "middle",
} as unknown as ViewStyle;

const styles = StyleSheet.create((theme) => ({
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 2,
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  button: {
    paddingHorizontal: 3,
    paddingVertical: theme.spacing[1],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

const INLINE_ROW_STYLE = [styles.inlineRow, INLINE_ROW_WEB_STYLE];

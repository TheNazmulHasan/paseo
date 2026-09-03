import { useMemo, type ReactElement, type ReactNode } from "react";
import type { ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { Copy, ExternalLink, FileText, FolderOpen, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useStableEvent } from "@/hooks/use-stable-event";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useAssistantFileLinkResolverContext } from "./provider";
import { useRevealInFileManager } from "./use-reveal-in-file-manager";

export interface AssistantLinkContextMenuProps {
  /** Set when the link opens in the browser. */
  externalUrl: string | null;
  /** Set when the link resolved to a local file or folder. */
  filePath: string | null;
  /** What "Copy" puts on the clipboard when neither of the above is known yet. */
  fallbackCopyText: string;
  /** The link's normal click action (browser for URLs, the workspace viewer for files). */
  onOpen: () => void;
  children: ReactNode;
}

interface LinkAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// RN doesn't type "inline-flex" but RN-web honors it, which keeps the trigger from breaking the
// surrounding line of text the same way the hover-tooltip wrapper does.
const INLINE_TRIGGER_STYLE: ViewStyle = {
  display: "inline-flex" as ViewStyle["display"],
};

/**
 * Right-click menu for every link and path in an assistant message: Open, Reveal in
 * Finder (paths, desktop + local daemon only) and Copy. Left click keeps doing what it did.
 */
export function AssistantLinkContextMenu({
  externalUrl,
  filePath,
  fallbackCopyText,
  onOpen,
  children,
}: AssistantLinkContextMenuProps): ReactElement {
  const { t } = useTranslation();
  const { configRef } = useAssistantFileLinkResolverContext();
  const revealInFileManager = useRevealInFileManager();

  const copyText = externalUrl ?? filePath ?? fallbackCopyText;
  const handleCopy = useStableEvent(() => {
    if (!copyText) return;
    void Clipboard.setStringAsync(copyText).then(() => {
      configRef.current.toast?.copied();
    });
  });
  const handleReveal = useStableEvent(() => {
    if (filePath) revealInFileManager?.reveal(filePath);
  });

  const actions = useMemo<LinkAction[]>(() => {
    const isLink = externalUrl !== null;
    const specs: Array<LinkAction | null> = [
      {
        key: "open",
        label: isLink ? t("message.actions.openLink") : t("workspace.fileActions.openFile"),
        icon: isLink ? ExternalLink : FileText,
        onSelect: onOpen,
      },
      !isLink && filePath && revealInFileManager
        ? {
            key: "reveal",
            label: t("workspace.fileActions.revealIn", {
              target: revealInFileManager.targetName,
            }),
            icon: FolderOpen,
            onSelect: handleReveal,
          }
        : null,
      copyText
        ? {
            key: "copy",
            label: isLink ? t("message.actions.copyLink") : t("workspace.fileActions.copyPath"),
            icon: Copy,
            onSelect: handleCopy,
          }
        : null,
    ];
    return specs.filter((spec): spec is LinkAction => spec !== null);
  }, [copyText, externalUrl, filePath, handleCopy, handleReveal, onOpen, revealInFileManager, t]);

  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly style={INLINE_TRIGGER_STYLE}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={220}>
        {actions.map((action) => (
          <LinkActionMenuItem key={action.key} action={action} />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LinkActionMenuItem({ action }: { action: LinkAction }): ReactElement {
  const leading = useMemo(() => {
    const ThemedIcon = withUnistyles(action.icon);
    return <ThemedIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />;
  }, [action.icon]);
  return (
    <ContextMenuItem leading={leading} onSelect={action.onSelect}>
      {action.label}
    </ContextMenuItem>
  );
}

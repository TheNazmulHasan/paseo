import { Text } from "react-native";
import { forwardRef, useCallback, useMemo, useState, type ComponentProps } from "react";
import type {
  CodeBlockRendererProps,
  LinkRendererProps,
  MarkdownRenderers,
} from "react-native-enriched-markdown";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AssistantLinkInlineActions, useFileLink } from "@/assistant-file-links";
import { AssistantLinkContextMenu } from "@/assistant-file-links/link-context-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import type { Theme } from "@/styles/theme";
import { isMermaidFenceLanguage, MermaidFence } from "./fence/mermaid";
import { markdownLinkSource } from "./source";

const ThemedCodeBlock = withUnistyles(HighlightedCodeBlock);
const codeStyle = (theme: Theme) => ({
  inheritedStyles: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  textStyle: { backgroundColor: theme.colors.surface2, padding: 12, borderRadius: 8 },
});
function WebCodeBlock({ code, language }: CodeBlockRendererProps) {
  if (isMermaidFenceLanguage(language)) return <MermaidFence code={code} />;
  return <ThemedCodeBlock code={code} language={language} uniProps={codeStyle} />;
}

// The library styles links inline, so a stylesheet :hover rule cannot underline them.
const LINK_HOVER_STYLE = { textDecoration: "underline" } as const;

function WebLink({ link, anchorProps, children }: LinkRendererProps) {
  const source = markdownLinkSource(link.url, link.sourceType);
  // Resolve bare file names up front so the icon row can say found / not found immediately.
  const { target, externalUrl, fileStatus, tooltipPath, onHoverIn, onPress } = useFileLink(
    source,
    { resolveEagerly: true },
  );
  const [hovered, setHovered] = useState(false);
  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);
  const anchorStyle = useMemo(
    () => ({
      ...anchorProps.style,
      overflowWrap: "anywhere" as const,
      ...(hovered ? LINK_HOVER_STYLE : null),
    }),
    [anchorProps.style, hovered],
  );
  const anchor = (
    <a
      {...anchorProps}
      style={anchorStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </a>
  );
  const filePath = target?.path ?? null;
  const fallbackCopyText = source.text?.trim() || source.href;
  // Left click and the hover path tooltip stay upstream's. On top of them: a right-click menu
  // and an always-visible Reveal / Copy row after the chip (the click already opens it).
  return (
    <>
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild onHoverIn={onHoverIn}>
          <InlineLinkTrigger>
            <AssistantLinkContextMenu
              externalUrl={externalUrl}
              filePath={filePath}
              fallbackCopyText={fallbackCopyText}
              onOpen={onPress}
              fileStatus={fileStatus}
            >
              {anchor}
            </AssistantLinkContextMenu>
          </InlineLinkTrigger>
        </TooltipTrigger>
        {tooltipPath ? (
          <TooltipContent side="top" align="start" maxWidth={520}>
            <Text selectable={false} style={styles.tooltipPath}>
              {tooltipPath}
            </Text>
          </TooltipContent>
        ) : null}
      </Tooltip>
      <AssistantLinkInlineActions
        externalUrl={externalUrl}
        filePath={filePath}
        fallbackCopyText={fallbackCopyText}
        onOpen={onPress}
        fileStatus={fileStatus}
      />
    </>
  );
}
// TooltipTrigger also supplies native Pressable handlers; forward only DOM events.
// A View renders a div, which is invalid inside the library's prose paragraphs.
const InlineLinkTrigger = forwardRef<HTMLSpanElement, ComponentProps<"span">>(
  function InlineLinkTrigger({ children, onMouseEnter, onMouseLeave, onFocus, onBlur }, ref) {
    return (
      <span
        ref={ref}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </span>
    );
  },
);
const styles = StyleSheet.create((theme) => ({
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

export const WEB_RENDERERS: MarkdownRenderers = { codeBlock: WebCodeBlock, link: WebLink };

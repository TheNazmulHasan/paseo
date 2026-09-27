import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownTextSpan } from "@/components/markdown-text";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { HighlightToken } from "@getpaseo/highlight";
import { isNative, isWeb } from "@/constants/platform";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { highlightToKeyedLines, type KeyedLine } from "@/utils/highlight-cache";
import {
  markdownCopyCodeBlockDataSet,
  markdownCopyDataSet,
  TRAILING_CODE_LINE_BREAKS,
} from "@/assistant-selection-copy/markup";
import { classifyCodeQuickAction } from "@/assistant-file-links/quick-action";
import { AssistantLinkContextMenu } from "@/assistant-file-links/link-context-menu";
import { AssistantLinkInlineActions } from "@/assistant-file-links/link-actions";
import { useOptionalAssistantFileLinkResolverContext } from "@/assistant-file-links/provider";
import { openExternalUrl } from "@/utils/open-external-url";

interface HighlightedCodeBlockProps {
  code: string;
  language: string | null | undefined;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

// Fence info strings ("```ts", "```typescript", "```ts {1,3}") map to the
// extension-based parser table in @getpaseo/highlight. Aliases here only
// cover names that don't already match an extension key in parsers.ts.
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};

function fenceLanguageToExtension(info: string | null | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const normalized = first.replace(/^\./, "");
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function stripTerminalFenceNewline(code: string): string {
  return code.endsWith("\n") ? code.slice(0, -1) : code;
}

export const HighlightedCodeBlock = React.memo(function HighlightedCodeBlock({
  code,
  language,
  inheritedStyles,
  textStyle,
}: HighlightedCodeBlockProps) {
  // Box styles (bg / padding / border / radius / margin) go on the wrapper View,
  // which lays the code and its corner buttons out side by side: the buttons own
  // their column, so the code wraps before them at any window width instead of
  // running underneath them.
  const { containerStyle, innerTextStyle } = useMemo(
    () => splitFenceStyle(inheritedStyles, textStyle),
    [inheritedStyles, textStyle],
  );
  const renderedCode = useMemo(() => stripTerminalFenceNewline(code), [code]);
  const copyDataSet = useMemo(
    () => ({ ...CODE_SURFACE_DATASET, ...markdownCopyCodeBlockDataSet(language) }),
    [language],
  );

  const keyedLines = useMemo<KeyedLine[] | null>(
    () => highlightToKeyedLines(renderedCode, fenceLanguageToExtension(language)),
    [renderedCode, language],
  );

  // Upstream hid Copy until hover to keep the block clean. Nazmul wants it in sight always:
  // a button you cannot see is a button you cannot trust. Permanent on every form factor.
  const controlsVisible = true;
  // Copy the code without its trailing blank lines. A fence body ends in a newline,
  // and ends in more than one when the author left a blank line before the closing
  // fence; pasting any of them into a terminal runs the last line.
  const getCode = useCallback(() => code.replace(TRAILING_CODE_LINE_BREAKS, ""), [code]);
  // A block that is just one path or one URL gets a second button: reveal it in Finder, or
  // open it in the browser. Copy stays for everything.
  const quickAction = useMemo(() => classifyCodeQuickAction(renderedCode), [renderedCode]);
  const fileLinkContext = useOptionalAssistantFileLinkResolverContext();
  const canOpenFile = Boolean(fileLinkContext?.configRef.current.onOpenWorkspaceFile);
  const handleOpen = useCallback(() => {
    if (quickAction?.kind === "url") {
      void openExternalUrl(quickAction.url);
      return;
    }
    if (quickAction?.kind === "path") {
      fileLinkContext?.configRef.current.onOpenWorkspaceFile?.(
        { raw: quickAction.path, path: quickAction.path },
        "preferred",
      );
    }
  }, [fileLinkContext, quickAction]);
  const quickActionOnOpen =
    quickAction?.kind === "url" || (quickAction?.kind === "path" && canOpenFile)
      ? handleOpen
      : undefined;

  const block = (
    <View style={containerStyle} dataSet={copyDataSet}>
      {keyedLines ? (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderCodeSegments(keyedLines)}
        </MarkdownTextSpan>
      ) : (
        <MarkdownTextSpan style={innerTextStyle} copyTag="code">
          {renderedCode}
        </MarkdownTextSpan>
      )}
      {quickAction ? (
        // A block that is one path or one URL keeps its actions in sight, like an inline chip.
        <CodeBlockActions visible>
          <AssistantLinkInlineActions
            layout="block"
            size={14}
            externalUrl={quickAction.kind === "url" ? quickAction.url : null}
            filePath={quickAction.kind === "path" ? quickAction.path : null}
            fallbackCopyText={renderedCode}
            onOpen={quickActionOnOpen}
          />
        </CodeBlockActions>
      ) : (
        <CodeBlockActions visible={controlsVisible}>
          <CopyButton getCode={getCode} />
        </CodeBlockActions>
      )}
    </View>
  );

  // Same right-click menu as an inline link, so a path behaves the same wherever it appears.
  if (!quickAction || isNative) {
    return block;
  }
  return (
    <AssistantLinkContextMenu
      layout="block"
      externalUrl={quickAction.kind === "url" ? quickAction.url : null}
      filePath={quickAction.kind === "path" ? quickAction.path : null}
      fallbackCopyText={renderedCode}
      onOpen={quickActionOnOpen}
    >
      {block}
    </AssistantLinkContextMenu>
  );
});

interface CodeBlockActionsProps {
  visible: boolean;
  children: React.ReactNode;
}

function CodeBlockActions({ visible, children }: CodeBlockActionsProps) {
  const visibilityStyle = visible
    ? copyButtonStyles.containerVisible
    : copyButtonStyles.containerHidden;
  const style = useMemo(() => [copyButtonStyles.actions, visibilityStyle], [visibilityStyle]);
  return (
    <View style={style} pointerEvents={visible ? "auto" : "none"}>
      {children}
    </View>
  );
}

function renderCodeSegments(keyedLines: KeyedLine[]): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < keyedLines.length; lineIndex += 1) {
    const line = keyedLines[lineIndex];
    if (lineIndex > 0) {
      segments.push(<CodeTextSpan key={`${line.key}-newline`} text={"\n"} />);
    }
    for (const { key, token } of line.tokens) {
      segments.push(<TokenSpan key={`${line.key}-${key}`} token={token} />);
    }
  }
  return segments;
}

interface TokenSpanProps {
  token: HighlightToken;
}

const TokenSpan = React.memo(function TokenSpan({ token }: TokenSpanProps) {
  return (
    <MarkdownTextSpan style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
      {token.text}
    </MarkdownTextSpan>
  );
});

interface CodeTextSpanProps {
  text: string;
}

const CodeTextSpan = React.memo(function CodeTextSpan({ text }: CodeTextSpanProps) {
  return <MarkdownTextSpan>{text}</MarkdownTextSpan>;
});

interface SplitStyles {
  containerStyle: StyleProp<ViewStyle>;
  innerTextStyle: StyleProp<TextStyle>;
}

const CONTAINER_BASE: ViewStyle = {
  position: "relative",
  flexDirection: "row",
  alignItems: "flex-start",
};
const CODE_TEXT_FILL: TextStyle = { flex: 1, minWidth: 0 };
const WEB_SELECTABLE: TextStyle = isWeb ? ({ userSelect: "text" } as TextStyle) : {};

function splitFenceStyle(inheritedStyles: TextStyle, textStyle: TextStyle): SplitStyles {
  const { fontFamily, fontSize, color, ...box } = textStyle;
  const textOnly: TextStyle = { ...WEB_SELECTABLE };
  if (fontFamily !== undefined) textOnly.fontFamily = fontFamily;
  if (fontSize !== undefined) textOnly.fontSize = fontSize;
  if (fontSize !== undefined) textOnly.lineHeight = Math.round(fontSize * 1.45);
  if (color !== undefined) textOnly.color = color;
  return {
    containerStyle: [box as ViewStyle, CONTAINER_BASE],
    innerTextStyle: [inheritedStyles, textOnly, CODE_TEXT_FILL],
  };
}

interface CopyButtonProps {
  getCode: () => string;
}

const COPIED_RESET_MS = 1500;

const CopyButton = React.memo(function CopyButton({ getCode }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handlePress = useCallback(async () => {
    const content = getCode();
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopied(false);
      resetRef.current = null;
    }, COPIED_RESET_MS);
  }, [getCode]);

  const label = copied ? t("message.actions.copied") : t("message.actions.copyCode");
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger
        onPress={handlePress}
        style={copyButtonStyles.container}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        dataSet={markdownCopyDataSet.ignore}
      >
        {({ hovered }) => {
          const iconColor = hovered
            ? copyButtonStyles.iconHoveredColor.color
            : copyButtonStyles.iconColor.color;
          return copied ? (
            <Check size={14} color={iconColor} />
          ) : (
            <Copy size={14} color={iconColor} />
          );
        }}
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <Text selectable={false} style={copyButtonStyles.tooltipText}>
          {label}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
});

const copyButtonStyles = StyleSheet.create((theme) => ({
  // In the row beside the code, not floating over it. The negative margins pull the
  // buttons' own padding back so the icons sit level with the first line of code.
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[1],
    marginLeft: theme.spacing[2],
    marginTop: -theme.spacing[1],
    marginRight: -theme.spacing[1],
  },
  container: {
    padding: theme.spacing[1],
  },
  containerVisible: {
    opacity: 1,
  },
  containerHidden: {
    opacity: 0,
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

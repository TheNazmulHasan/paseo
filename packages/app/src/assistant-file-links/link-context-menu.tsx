import { useMemo, type ReactElement, type ReactNode } from "react";
import type { ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  useAssistantLinkActions,
  type AssistantLinkAction,
  type AssistantLinkActionsInput,
} from "./link-actions";

export interface AssistantLinkContextMenuProps extends AssistantLinkActionsInput {
  /** Inline (default) sits inside a line of text; block wraps a whole code block. */
  layout?: "inline" | "block";
  children: ReactNode;
}

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// RN doesn't type "inline-flex" but RN-web honors it, which keeps the trigger from breaking the
// surrounding line of text the same way the hover-tooltip wrapper does.
const INLINE_TRIGGER_STYLE: ViewStyle = {
  display: "inline-flex" as ViewStyle["display"],
};

/**
 * Right-click menu with the same actions as the inline icon row (`AssistantLinkInlineActions`).
 * Left click keeps doing what it did.
 */
export function AssistantLinkContextMenu({
  layout = "inline",
  children,
  ...input
}: AssistantLinkContextMenuProps): ReactElement {
  const actions = useAssistantLinkActions(input);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        contextOnly
        style={layout === "inline" ? INLINE_TRIGGER_STYLE : undefined}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={220}>
        {actions.map((action) => (
          <LinkActionMenuItem key={action.id} action={action} />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LinkActionMenuItem({ action }: { action: AssistantLinkAction }): ReactElement {
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

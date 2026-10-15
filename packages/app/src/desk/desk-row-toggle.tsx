import { BookmarkMinus, BookmarkPlus } from "lucide-react-native";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { useDeskToggle } from "@/desk/use-desk-toggle";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";

/**
 * "Put on Desk" / "Take off Desk" on a sidebar row. Always visible on the open workspace, so the
 * keyboard shortcut has a visible twin; on any other row it appears while the row is hovered.
 */
export function DeskRowToggle({
  workspaceKey,
  serverId,
  workspaceId,
  isHovered,
}: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  isHovered: boolean;
}) {
  const selection = useActiveWorkspaceSelection();
  const { onDesk, toggle, label } = useDeskToggle(workspaceKey);
  const shortcutKeys = useShortcutKeys("desk-toggle");
  const isActive = selection?.serverId === serverId && selection.workspaceId === workspaceId;
  if (!isActive && !isHovered) {
    return null;
  }
  return (
    <DeskIconButton
      icon={onDesk ? BookmarkMinus : BookmarkPlus}
      label={label}
      shortcutKeys={shortcutKeys}
      onPress={toggle}
      testID={`sidebar-workspace-desk-toggle-${workspaceKey}`}
      size={14}
    />
  );
}

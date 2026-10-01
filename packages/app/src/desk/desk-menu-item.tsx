import { BookmarkMinus, BookmarkPlus } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useDeskToggle } from "@/desk/use-desk-toggle";
import type { Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedBookmarkPlus = withUnistyles(BookmarkPlus);
const ThemedBookmarkMinus = withUnistyles(BookmarkMinus);
const putOnLeadingIcon = <ThemedBookmarkPlus size={14} uniProps={foregroundMutedColorMapping} />;
const takeOffLeadingIcon = <ThemedBookmarkMinus size={14} uniProps={foregroundMutedColorMapping} />;

/** The Desk toggle for a workspace row's context menu and kebab menu. */
export function DeskMenuItem({
  surface,
  workspaceKey,
}: {
  surface: "context" | "dropdown";
  workspaceKey: string;
}) {
  const { onDesk, toggle, label } = useDeskToggle(workspaceKey);
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <Item
      testID={`sidebar-workspace-menu-desk-${workspaceKey}`}
      leading={onDesk ? takeOffLeadingIcon : putOnLeadingIcon}
      onSelect={toggle}
    >
      {label}
    </Item>
  );
}

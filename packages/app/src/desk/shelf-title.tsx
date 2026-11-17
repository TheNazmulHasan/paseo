import { type LayoutChangeEvent } from "react-native";
import { type ReactNode } from "react";
import { FoldersSectionHeader } from "@/folders/folders-section";

/**
 * The header of the sidebar's second section: always "Folders" (the Desk is its first folder).
 * It takes the old Shelf header's place and carries its display menu (`children`), the only way back
 * out of a sidebar filter. `titleAccessory` (the Shelf's inline Project / Status control) is no
 * longer drawn: the Shelf only remains for a sidebar whose hosts have no folders, and Group by
 * stays in the display menu there.
 */
export function ShelfSectionHeader({
  onLayout,
  children,
}: {
  titleAccessory?: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
}) {
  return <FoldersSectionHeader onLayout={onLayout}>{children}</FoldersSectionHeader>;
}

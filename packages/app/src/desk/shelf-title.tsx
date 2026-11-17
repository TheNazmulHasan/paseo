import { useTranslation } from "react-i18next";
import { Text, type LayoutChangeEvent } from "react-native";
import { type ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { useDeskStore } from "@/desk/desk-store";
import { FoldersSectionHeader, useFoldersReplaceShelf } from "@/folders/folders-section";

/**
 * The Shelf's header: "Shelf", how many workspaces it holds, and the fold chevron. It replaces the
 * plain "Workspaces" label, built on the shared sidebar section header, so the grouping control
 * (`titleAccessory`) and the display menu (`children`) stay reachable while the Shelf is folded.
 */
export function ShelfSectionHeader({
  titleAccessory,
  onLayout,
  children,
}: {
  titleAccessory?: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { shelfCount } = useSidebarModel();
  const collapsed = useDeskStore((state) => state.shelfCollapsed);
  const toggleCollapsed = useDeskStore((state) => state.toggleShelfCollapsed);
  const foldersReplaceShelf = useFoldersReplaceShelf();

  // Folders mod: the Folders header takes the Shelf's place (and its display menu), without the
  // Project / Status grouping control, which only ever governed the Shelf.
  if (foldersReplaceShelf) {
    return <FoldersSectionHeader onLayout={onLayout}>{children}</FoldersSectionHeader>;
  }

  return (
    <SidebarSectionHeader
      title={t("sidebar.shelf.title")}
      collapsed={collapsed}
      onToggle={toggleCollapsed}
      chevronAlwaysVisible
      testID="sidebar-shelf-header"
      onLayout={onLayout}
      titleAccessory={
        <>
          <Text style={styles.count} testID="sidebar-shelf-count">
            {shelfCount}
          </Text>
          {titleAccessory}
        </>
      }
    >
      {children}
    </SidebarSectionHeader>
  );
}

const styles = StyleSheet.create((theme) => ({
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.7,
  },
}));

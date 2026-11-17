import { useCallback, useMemo, type ReactElement } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder, FolderInput, FolderMinus, FolderPlus } from "lucide-react-native";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { useFolderIndex } from "@/folders/folder-store";
import { openFolderPicker } from "@/folders/folder-picker-store";
import { folderKeyOfItem, type FolderGroup, type FolderItemRef } from "@/folders/model";
import { useCanFileOnHost, useFolderActions } from "@/folders/use-folder-actions";
import type { Theme } from "@/styles/theme";

/** The `MenuSubTrigger` on a workspace's menu that opens the folder page. */
export const WORKSPACE_FOLDER_PAGE_ID = "workspaceFolders";

const ThemedFolder = withUnistyles(Folder);
const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedFolderMinus = withUnistyles(FolderMinus);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const triggerLeading = <ThemedFolderInput size={14} uniProps={mutedMapping} />;
const folderLeading = <ThemedFolder size={14} uniProps={mutedMapping} />;
const removeLeading = <ThemedFolderMinus size={14} uniProps={mutedMapping} />;
const createLeading = <ThemedFolderPlus size={14} uniProps={mutedMapping} />;

function FolderMenuRow({
  group,
  current,
  onMove,
}: {
  group: FolderGroup;
  current: boolean;
  onMove: (folderKey: string) => void;
}) {
  const leading = useMemo(
    () => (group.emoji ? <Text style={styles.emoji}>{group.emoji}</Text> : folderLeading),
    [group.emoji],
  );
  const handleSelect = useCallback(() => onMove(group.key), [group.key, onMove]);
  return (
    <MenuItem
      leading={leading}
      selected={current}
      onSelect={handleSelect}
      testID={`folder-menu-row-${group.key}`}
    >
      {group.name}
    </MenuItem>
  );
}

/**
 * Every folder with the item's own ticked, then "New folder…" (it opens the picker, where the name
 * is typed) and "Remove from folder". Picking a folder files the item and closes the menu.
 */
function FolderMenuPage({ item }: { item: FolderItemRef }): ReactElement {
  const { t } = useTranslation();
  const index = useFolderIndex();
  const { moveItem } = useFolderActions();
  const currentKey = folderKeyOfItem(index, item);
  const handleMove = useCallback(
    (folderKey: string) => {
      void moveItem(item, folderKey);
    },
    [item, moveItem],
  );
  const handleCreate = useCallback(() => openFolderPicker(item), [item]);
  const handleRemove = useCallback(() => {
    void moveItem(item, null);
  }, [item, moveItem]);
  return (
    <>
      {index.groups.map((group) => (
        <FolderMenuRow
          key={group.key}
          group={group}
          current={group.key === currentKey}
          onMove={handleMove}
        />
      ))}
      {index.groups.length > 0 ? <MenuSeparator /> : null}
      <MenuItem leading={createLeading} onSelect={handleCreate} testID="folder-menu-create">
        {t("folders.menu.newFolder")}
      </MenuItem>
      <MenuItem
        leading={removeLeading}
        disabled={currentKey === null}
        onSelect={handleRemove}
        testID="folder-menu-remove"
      >
        {t("folders.menu.remove")}
      </MenuItem>
    </>
  );
}

/** The folder page appended to a workspace menu's own pages. */
export function useFolderMenuPages(
  basePages: readonly MenuPageDefinition[],
  target: { serverId: string; workspaceId: string } | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const serverId = target?.serverId ?? "";
  const workspaceId = target?.workspaceId ?? "";
  const hasTarget = target !== null;
  const canFile = useCanFileOnHost(serverId);
  const item = useMemo<FolderItemRef>(
    () => ({ kind: "workspace", serverId, workspaceId }),
    [serverId, workspaceId],
  );
  return useMemo(() => {
    if (!hasTarget || !canFile) return basePages;
    return [
      ...basePages,
      {
        id: WORKSPACE_FOLDER_PAGE_ID,
        title: t("folders.moveTo"),
        content: <FolderMenuPage item={item} />,
      },
    ];
  }, [basePages, canFile, hasTarget, item, t]);
}

/** "Move to folder ▸" on a workspace menu; absent on a host whose folders are not available. */
export function WorkspaceFolderSubTrigger({
  workspaceKey,
  serverId,
}: {
  workspaceKey: string;
  serverId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const canFile = useCanFileOnHost(serverId);
  if (!canFile) return null;
  return (
    <MenuSubTrigger
      id={WORKSPACE_FOLDER_PAGE_ID}
      leading={triggerLeading}
      testID={`sidebar-workspace-menu-folder-${workspaceKey}`}
    >
      {t("folders.moveTo")}
    </MenuSubTrigger>
  );
}

const styles = StyleSheet.create(() => ({
  emoji: { fontSize: 14, width: 14, textAlign: "center" },
}));

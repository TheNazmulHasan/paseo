import { createContext, useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Bookmark, FolderInput, Pin } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DeskIconButton } from "@/desk/desk-icon-button";
import { useDeskStore } from "@/desk/desk-store";
import { openFolderPicker } from "@/folders/folder-picker-store";
import { useCanFileOnHost, useFoldersAvailable } from "@/folders/use-folder-actions";
import type { FolderItemRef } from "@/folders/model";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";

const ThemedBookmark = withUnistyles(Bookmark);
const ThemedPin = withUnistyles(Pin);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** True inside a folder's list: a workspace there may also sit on the Desk or be Pinned. */
export const FolderRowContext = createContext(false);

/**
 * The always-visible folder icon on a workspace row: it opens the folder picker for that
 * workspace, so the keyboard key (Ctrl+Cmd+M) has a visible twin. Inside a folder's list a
 * workspace that is also on the Desk or Pinned carries a small mark saying so, because it shows
 * again in those sections.
 */
export function WorkspaceFolderButton({
  workspaceKey,
  serverId,
  workspaceId,
  pinned,
}: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  pinned: boolean;
}) {
  const { t } = useTranslation();
  const canFile = useCanFileOnHost(serverId);
  const inFolder = useContext(FolderRowContext);
  const onDesk = useDeskStore((state) => state.deskKeys.includes(workspaceKey));
  const shortcutKeys = useShortcutKeys("folder-move");
  const handlePress = useCallback(
    () => openFolderPicker({ kind: "workspace", serverId, workspaceId }),
    [serverId, workspaceId],
  );
  if (!canFile) {
    return null;
  }
  const markLabel = pinned ? t("folders.alsoPinned") : t("folders.alsoOnDesk");
  return (
    <>
      {inFolder && (pinned || onDesk) ? (
        <View
          style={styles.mark}
          accessibilityLabel={markLabel}
          testID={`sidebar-workspace-folder-mark-${workspaceKey}`}
        >
          {pinned ? (
            <ThemedPin size={12} uniProps={mutedMapping} />
          ) : (
            <ThemedBookmark size={12} uniProps={mutedMapping} />
          )}
        </View>
      ) : null}
      <DeskIconButton
        icon={FolderInput}
        label={t("folders.moveTo")}
        shortcutKeys={shortcutKeys}
        onPress={handlePress}
        testID={`sidebar-workspace-folder-${workspaceKey}`}
        size={14}
      />
    </>
  );
}

/** The same icon on a view row. */
export function BoardFolderButton({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const canFile = useFoldersAvailable();
  const shortcutKeys = useShortcutKeys("folder-move");
  const handlePress = useCallback(() => {
    const item: FolderItemRef = { kind: "board", boardId };
    openFolderPicker(item);
  }, [boardId]);
  if (!canFile) {
    return null;
  }
  return (
    <DeskIconButton
      icon={FolderInput}
      label={t("folders.moveTo")}
      shortcutKeys={shortcutKeys}
      onPress={handlePress}
      testID={`sidebar-view-folder-${boardId}`}
    />
  );
}

const styles = StyleSheet.create(() => ({
  mark: {
    width: 14,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
}));

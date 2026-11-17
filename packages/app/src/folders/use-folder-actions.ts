import { createElement, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { DeskUndoToast } from "@/desk/desk-undo-toast";
import {
  createFolderAndFile,
  createFolderFromInput,
  deleteFolderGroup,
  fileItem,
  FolderHostUnavailableError,
  renameFolderGroup,
  restoreDeletedFolder,
} from "@/folders/actions";
import { getFolderIndex, useFolderStore } from "@/folders/folder-store";
import { parseFolderNameInput, type FolderGroup, type FolderItemRef } from "@/folders/model";

const UNDO_TOAST_MS = 6000;

export interface FolderActions {
  /** Files an item into a folder group; null takes it out of its folder (Unfiled). */
  moveItem: (item: FolderItemRef, folderKey: string | null) => Promise<boolean>;
  /** Makes a folder from the one-box name and files the item in it. */
  createAndMove: (item: FolderItemRef, rawName: string) => Promise<boolean>;
  createFolder: (rawName: string) => Promise<boolean>;
  renameFolder: (group: FolderGroup, rawName: string) => Promise<boolean>;
  /** Deletes the folder (its items become Unfiled) and offers Undo. */
  deleteFolder: (group: FolderGroup) => Promise<void>;
}

/** Folder actions with their toasts. Each resolves true when it worked; failures are toasted. */
export function useFolderActions(): FolderActions {
  const { t } = useTranslation();
  const toast = useToast();

  const report = useCallback(
    (error: unknown) => {
      if (error instanceof FolderHostUnavailableError) {
        toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
        return;
      }
      toast.error(error instanceof Error ? error.message : String(error));
    },
    [t, toast],
  );

  const showMoved = useCallback(
    (folderKey: string | null) => {
      const group = folderKey
        ? getFolderIndex().groups.find((candidate) => candidate.key === folderKey)
        : null;
      toast.show(
        group ? t("folders.toasts.moved", { name: group.name }) : t("folders.toasts.removed"),
      );
    },
    [t, toast],
  );

  const moveItem = useCallback<FolderActions["moveItem"]>(
    async (item, folderKey) => {
      try {
        await fileItem(item, folderKey);
        showMoved(folderKey);
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report, showMoved],
  );

  const createAndMove = useCallback<FolderActions["createAndMove"]>(
    async (item, rawName) => {
      try {
        await createFolderAndFile(item, rawName);
        toast.show(t("folders.toasts.moved", { name: parseFolderNameInput(rawName).name }));
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report, t, toast],
  );

  const createFolder = useCallback<FolderActions["createFolder"]>(
    async (rawName) => {
      try {
        await createFolderFromInput(rawName);
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report],
  );

  const renameFolder = useCallback<FolderActions["renameFolder"]>(
    async (group, rawName) => {
      try {
        await renameFolderGroup(group, rawName);
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report],
  );

  const deleteFolder = useCallback<FolderActions["deleteFolder"]>(
    async (group) => {
      try {
        const record = await deleteFolderGroup(group);
        const handleUndo = () => {
          void restoreDeletedFolder(record)
            .then(() => {
              toast.show(t("folders.toasts.restored", { name: record.name }));
              return undefined;
            })
            .catch(report);
        };
        toast.show(
          createElement(DeskUndoToast, {
            message: t("folders.toasts.deleted", { name: record.name }),
            undoLabel: t("sidebar.desk.undo"),
            onUndo: handleUndo,
          }),
          { durationMs: UNDO_TOAST_MS },
        );
      } catch (error) {
        report(error);
      }
    },
    [report, t, toast],
  );

  return useMemo(
    () => ({ moveItem, createAndMove, createFolder, renameFolder, deleteFolder }),
    [createAndMove, createFolder, deleteFolder, moveItem, renameFolder],
  );
}

/** True when this host's folders have loaded, so an item on it can be filed. */
export function useCanFileOnHost(serverId: string): boolean {
  return useFolderStore((state) => serverId in state.snapshots);
}

/** True when any host has folders loaded (the Folders section replaces the Shelf). */
export function useFoldersAvailable(): boolean {
  return useFolderStore((state) => Object.keys(state.snapshots).length > 0);
}

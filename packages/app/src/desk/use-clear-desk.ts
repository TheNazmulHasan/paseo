import { createElement, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useDeskStore } from "@/desk/desk-store";
import { DeskUndoToast } from "@/desk/desk-undo-toast";
import { selectClearableDeskKeys, type DeskGroup } from "@/desk/model";

const UNDO_TOAST_MS = 6000;

/** "Clear desk": sends every Done workspace on the Desk back to the Shelf, with an Undo toast. */
export function useClearDesk(deskGroups: readonly DeskGroup[]): () => void {
  const { t } = useTranslation();
  const toast = useToast();
  const removeDeskKeys = useDeskStore((state) => state.removeDeskKeys);
  const restoreDeskKeys = useDeskStore((state) => state.restoreDeskKeys);

  return useCallback(() => {
    const rows = deskGroups.flatMap((group) => group.rows);
    const cleared = selectClearableDeskKeys({
      deskKeys: rows.map((row) => row.workspaceKey),
      statusBucketByKey: new Map(rows.map((row) => [row.workspaceKey, row.statusBucket])),
    });
    if (cleared.length === 0) {
      toast.show(t("sidebar.desk.nothingToClear"));
      return;
    }
    removeDeskKeys(cleared);
    const handleUndo = () => {
      restoreDeskKeys(cleared);
      toast.show(t("sidebar.desk.undone"));
    };
    toast.show(
      createElement(DeskUndoToast, {
        message: t("sidebar.desk.cleared", { count: cleared.length }),
        undoLabel: t("sidebar.desk.undo"),
        onUndo: handleUndo,
      }),
      { durationMs: UNDO_TOAST_MS },
    );
  }, [deskGroups, removeDeskKeys, restoreDeskKeys, t, toast]);
}

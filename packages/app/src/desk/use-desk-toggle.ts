import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeskStore } from "@/desk/desk-store";

/** One workspace's Desk membership and the toggle, for any surface (row button, menu item). */
export function useDeskToggle(workspaceKey: string): {
  onDesk: boolean;
  toggle: () => void;
  label: string;
} {
  const { t } = useTranslation();
  const onDesk = useDeskStore((state) => state.deskKeys.includes(workspaceKey));
  const toggleDesk = useDeskStore((state) => state.toggleDesk);
  const toggle = useCallback(() => {
    toggleDesk(workspaceKey);
  }, [toggleDesk, workspaceKey]);
  return { onDesk, toggle, label: onDesk ? t("sidebar.desk.takeOff") : t("sidebar.desk.putOn") };
}

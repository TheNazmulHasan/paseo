import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useDeskStore } from "@/desk/desk-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const DESK_TOGGLE_ACTIONS: readonly KeyboardActionId[] = ["workspace.desk.toggle"];

// Toggles the workspace open in the window, the same "active workspace" the pin shortcut uses
// (route selection, not a focused pane). The toast stands in for the sidebar row, which may be
// collapsed or scrolled away when the shortcut fires.
export function useGlobalDeskToggleAction() {
  const { t } = useTranslation();
  const toast = useToast();
  const toggleDesk = useDeskStore((state) => state.toggleDesk);
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const routeWorkspaceId = selection?.workspaceId ?? null;
  // The route carries an opaque id that need not equal the descriptor id the sidebar keys on.
  const fields = useWorkspaceFields(serverId, routeWorkspaceId, (workspace) => ({
    id: workspace.id,
  }));

  const handle = useCallback(() => {
    if (!serverId || !fields) {
      return false;
    }
    const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId: fields.id });
    if (!workspaceKey) {
      return false;
    }
    const onDesk = toggleDesk(workspaceKey);
    toast.show(onDesk ? t("sidebar.desk.added") : t("sidebar.desk.removed"));
    return true;
  }, [fields, serverId, t, toast, toggleDesk]);

  useKeyboardActionHandler({
    handlerId: "workspace-desk-toggle-global",
    actions: DESK_TOGGLE_ACTIONS,
    enabled: serverId !== null && fields !== null,
    priority: 0,
    handle,
  });
}

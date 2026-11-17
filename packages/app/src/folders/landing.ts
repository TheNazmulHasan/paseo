import { fileItem } from "@/folders/actions";
import { getFolderIndex, useFolderStore } from "@/folders/folder-store";
import { activeExplicitFolderKey, planNewWorkspaceFiling } from "@/folders/model";
import { useWorkspaceSwitcherMruStore } from "@/workspace-switcher/mru-store";

/**
 * Files brand-new workspaces where the user was: the folder they picked with + on a folder, else
 * the folder of the place they were in just before (workspace or view, from the Hyper+J history).
 * Called by the Desk's reconcile with the keys it just put on the Desk, which are exactly the new
 * non-background workspaces. Silent: a failure leaves the workspace Unfiled, which is the honest
 * "still to sort" state, and the next push shows whatever really happened.
 */
export function landNewWorkspaces(landedKeys: readonly string[]): void {
  if (landedKeys.length === 0) return;
  const store = useFolderStore.getState();
  const { plans, usedExplicit } = planNewWorkspaceFiling({
    landedKeys,
    index: getFolderIndex(),
    history: useWorkspaceSwitcherMruStore.getState().history,
    explicitFolderKey: activeExplicitFolderKey(store.explicitFolder, Date.now()),
  });
  if (usedExplicit) {
    store.setExplicitFolder(null);
  }
  for (const plan of plans) {
    fileItem(
      { kind: "workspace", serverId: plan.serverId, workspaceId: plan.workspaceId },
      plan.folderKey,
    ).catch((error) => console.warn("[Folders] could not file the new workspace", error));
  }
}

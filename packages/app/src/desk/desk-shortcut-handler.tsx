import { useGlobalDeskToggleAction } from "@/desk/use-global-desk-toggle-action";

// Headless host, same shape as `WorkspacePinShortcutHandler`: keeps the active-workspace
// subscription out of the root layout.
export function DeskShortcutHandler() {
  useGlobalDeskToggleAction();
  return null;
}

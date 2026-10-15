import { useMemo } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { useOptionalAssistantFileLinkResolverContext } from "./provider";
import { getRevealParentPath } from "./quick-action";

export interface RevealInFileManager {
  /** "Finder" on macOS, "Explorer" on Windows, "Files" elsewhere. */
  targetName: string;
  /** Opens the containing folder in the system file manager with `path` selected. */
  reveal: (path: string) => void;
}

/**
 * Reveal-in-Finder for paths that appear in chat. Only available on the desktop app when the
 * message came from the local daemon — a path on a remote machine means nothing to this Finder.
 * Returns null anywhere else so callers can simply hide the affordance.
 */
export function useRevealInFileManager(): RevealInFileManager | null {
  const context = useOptionalAssistantFileLinkResolverContext();
  const serverId = context?.configRef.current.serverId ?? "";
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets } = useDesktopOpenTargets({ isLocalExecution: isLocalDaemon });
  const fileManagerTarget = useMemo(
    () => targets.find((target) => target.kind === "file-manager") ?? null,
    [targets],
  );

  const reveal = useStableEvent((path: string) => {
    if (!fileManagerTarget) return;
    const toast = context?.configRef.current.toast ?? null;
    void openDesktopTarget({
      editorId: fileManagerTarget.id,
      workspacePath: getRevealParentPath(path),
      filePath: path,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast?.error(message);
    });
  });

  return useMemo(
    () => (fileManagerTarget ? { targetName: fileManagerTarget.label, reveal } : null),
    [fileManagerTarget, reveal],
  );
}

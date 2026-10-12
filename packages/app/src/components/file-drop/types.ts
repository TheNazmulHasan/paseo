import type { ImageAttachment } from "@/composer/types";
import type { WorkspaceFileDragPayload } from "@/attachments/workspace-file-drag";

export interface DroppedFileItem {
  kind: "web-file";
  file: File;
}
export interface DroppedPathItem {
  kind: "desktop-path";
  path: string;
}
export type DroppedItem = DroppedFileItem | DroppedPathItem;

/**
 * What a consumer (e.g. a composer) registers to receive files dropped onto the
 * surrounding FileDropZone. Raster images arrive already persisted via `onFiles`;
 * everything else arrives raw via `onGenericFiles`.
 */
export interface FileDropSink {
  onFiles: (images: ImageAttachment[]) => void;
  onGenericFiles?: (items: DroppedItem[]) => void;
  onWorkspaceFile?: (payload: WorkspaceFileDragPayload) => void;
  /**
   * Skip the raster-image persistence branch: every dropped file arrives only
   * via `onGenericFiles`. For consumers that handle raw bytes themselves (e.g.
   * the file explorer uploading into the workspace).
   */
  skipImagePersistence?: boolean;
  /** Dropped folders are never delivered as files; their count arrives here. */
  onSkippedDirectories?: (count: number) => void;
}

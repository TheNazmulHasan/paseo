import type { Logger } from "pino";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { FolderError, type FileBackedFolderRegistry } from "./folder-registry.js";

export interface FolderSessionHost {
  emit(message: SessionOutboundMessage): void;
}

type FolderRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "folders.list.request"
      | "folders.create.request"
      | "folders.update.request"
      | "folders.delete.request"
      | "folders.reorder.request"
      | "folders.assign.request";
  }
>;

/**
 * Nazmul mod (folders): the folders.* RPCs of one session. State changes reach every connected
 * client through the registry's change feed (`folders_update`), not through these replies, so
 * a change made by an agent tool or the CLI looks the same to the app as one made by a tap.
 * Handlers only answer the caller.
 */
export class FolderSession {
  constructor(
    private readonly options: {
      host: FolderSessionHost;
      registry: FileBackedFolderRegistry;
      logger: Logger;
    },
  ) {}

  /** Returns undefined for any message that is not a folders.* request. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "folders.list.request":
        return this.handleList(msg);
      case "folders.create.request":
        return this.handleCreate(msg);
      case "folders.update.request":
        return this.handleUpdate(msg);
      case "folders.delete.request":
        return this.handleDelete(msg);
      case "folders.reorder.request":
        return this.handleReorder(msg);
      case "folders.assign.request":
        return this.handleAssign(msg);
      default:
        return undefined;
    }
  }

  private async handleList(msg: Extract<FolderRequest, { type: "folders.list.request" }>) {
    try {
      const { folders, membership } = await this.options.registry.getSnapshot();
      this.emit({
        type: "folders.list.response",
        payload: { requestId: msg.requestId, folders, membership, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.list.response",
        payload: {
          requestId: msg.requestId,
          folders: [],
          membership: {},
          error: this.errorMessage(msg, error),
        },
      });
    }
  }

  private async handleCreate(msg: Extract<FolderRequest, { type: "folders.create.request" }>) {
    try {
      const folder = await this.options.registry.createFolder({
        name: msg.name,
        emoji: msg.emoji,
        order: msg.order,
      });
      this.emit({
        type: "folders.create.response",
        payload: { requestId: msg.requestId, folder, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.create.response",
        payload: { requestId: msg.requestId, folder: null, error: this.errorMessage(msg, error) },
      });
    }
  }

  private async handleUpdate(msg: Extract<FolderRequest, { type: "folders.update.request" }>) {
    try {
      const folder = await this.options.registry.updateFolder({
        folderId: msg.folderId,
        name: msg.name,
        emoji: msg.emoji,
      });
      this.emit({
        type: "folders.update.response",
        payload: { requestId: msg.requestId, folder, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.update.response",
        payload: { requestId: msg.requestId, folder: null, error: this.errorMessage(msg, error) },
      });
    }
  }

  private async handleDelete(msg: Extract<FolderRequest, { type: "folders.delete.request" }>) {
    try {
      const { folder, releasedItemKeys } = await this.options.registry.deleteFolder(msg.folderId);
      this.emit({
        type: "folders.delete.response",
        payload: { requestId: msg.requestId, folder, releasedItemKeys, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.delete.response",
        payload: {
          requestId: msg.requestId,
          folder: null,
          releasedItemKeys: [],
          error: this.errorMessage(msg, error),
        },
      });
    }
  }

  private async handleReorder(msg: Extract<FolderRequest, { type: "folders.reorder.request" }>) {
    try {
      const folders = await this.options.registry.reorderFolders(msg.folderIds);
      this.emit({
        type: "folders.reorder.response",
        payload: { requestId: msg.requestId, folders, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.reorder.response",
        payload: { requestId: msg.requestId, folders: [], error: this.errorMessage(msg, error) },
      });
    }
  }

  private async handleAssign(msg: Extract<FolderRequest, { type: "folders.assign.request" }>) {
    try {
      const itemKeys = await this.options.registry.assignItems(msg.itemKeys, msg.folderId);
      this.emit({
        type: "folders.assign.response",
        payload: { requestId: msg.requestId, itemKeys, folderId: msg.folderId, error: null },
      });
    } catch (error) {
      this.emit({
        type: "folders.assign.response",
        payload: {
          requestId: msg.requestId,
          itemKeys: [],
          folderId: msg.folderId,
          error: this.errorMessage(msg, error),
        },
      });
    }
  }

  private emit(message: SessionOutboundMessage): void {
    this.options.host.emit(message);
  }

  /** What a caller did wrong is said as is; anything else is logged first. */
  private errorMessage(msg: FolderRequest, error: unknown): string {
    if (error instanceof FolderError) return error.message;
    this.options.logger.error({ err: error, requestType: msg.type }, "Folder request failed");
    return getErrorMessage(error);
  }
}

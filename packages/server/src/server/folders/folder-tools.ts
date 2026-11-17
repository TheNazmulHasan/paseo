import { z } from "zod";
import {
  FOLDER_EMOJI_MAX_LENGTH,
  FOLDER_NAME_MAX_LENGTH,
  findFolderByRef,
  isBoardFolderItemKey,
  type Folder,
} from "@getpaseo/protocol/folders";

import { ensureValidJson } from "../json-utils.js";
import {
  PaseoToolInputError,
  type PaseoToolConfig,
  type PaseoToolExecutionContext,
  type PaseoToolResult,
} from "../agent/tools/types.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import { FolderError, type FileBackedFolderRegistry } from "./folder-registry.js";

type RegisterTool = (
  name: string,
  config: PaseoToolConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
  handler: (input: any, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>,
) => void;

export interface FolderToolsOptions {
  registerTool: RegisterTool;
  registry: Pick<FileBackedFolderRegistry, "getSnapshot" | "createFolder" | "assignItems">;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "list">;
}

const FolderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().nullable(),
  order: z.number(),
});

const FOLDER_ID_PATTERN = /^fld_[0-9a-f]{16}$/;

function summarize(folder: Folder) {
  return { id: folder.id, name: folder.name, emoji: folder.emoji, order: folder.order };
}

/** A FolderError is the caller's mistake; surface it as a tool input error. */
async function translateFolderErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FolderError) throw new PaseoToolInputError(error.message);
    throw error;
  }
}

/**
 * Nazmul mod (folders): `list_folders`, `create_folder` and `set_workspace_folder`. They are how an
 * agent sorts workspaces for the user ("put this in Faith") without any UI.
 */
export function registerFolderTools(options: FolderToolsOptions): void {
  const { registerTool, registry, workspaceRegistry } = options;

  async function assertWorkspacesExist(ids: readonly string[]): Promise<void> {
    if (!workspaceRegistry) return;
    const missing: string[] = [];
    for (const id of ids) if (!(await workspaceRegistry.get(id))) missing.push(id);
    if (missing.length > 0) {
      throw new PaseoToolInputError(`Workspace not found: ${missing.join(", ")}`);
    }
  }

  async function findFolder(ref: string): Promise<Folder | null> {
    return findFolderByRef((await registry.getSnapshot()).folders, ref);
  }

  /** The folder named by an id or a name; made from the name when allowed and nothing matches. */
  async function resolveTargetFolder(
    ref: string,
    createIfMissing: boolean,
  ): Promise<{ target: Folder; created: boolean }> {
    const existing = await findFolder(ref);
    if (existing) return { target: existing, created: false };
    if (!createIfMissing || FOLDER_ID_PATTERN.test(ref)) {
      throw new PaseoToolInputError(
        `Folder not found: ${ref}. Use list_folders, or set createIfMissing to create it.`,
      );
    }
    try {
      return { target: await registry.createFolder({ name: ref }), created: true };
    } catch (error) {
      if (!(error instanceof FolderError)) throw error;
      // Another call made it a moment ago: use that one.
      const raced = error.code === "duplicate_name" ? await findFolder(ref) : null;
      if (raced) return { target: raced, created: false };
      throw new PaseoToolInputError(error.message);
    }
  }

  registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "List the user's sidebar folders. Each has its id, name, emoji, item count and the workspace ids inside. Also lists the active workspaces in no folder (Unfiled) when it can.",
      inputSchema: {},
      outputSchema: {
        folders: z.array(
          FolderSummarySchema.extend({
            itemCount: z.number(),
            workspaceIds: z.array(z.string()),
          }),
        ),
        unfiledWorkspaceIds: z.array(z.string()).optional(),
      },
    },
    async () => {
      const { folders, membership } = await registry.getSnapshot();
      const activeWorkspaceIds = workspaceRegistry
        ? new Set(
            (await workspaceRegistry.list())
              .filter((workspace) => !workspace.archivedAt)
              .map((workspace) => workspace.workspaceId),
          )
        : null;
      const itemsByFolder = new Map<string, string[]>();
      for (const [itemKey, folderId] of Object.entries(membership)) {
        itemsByFolder.set(folderId, [...(itemsByFolder.get(folderId) ?? []), itemKey]);
      }
      const result = folders.map((folder) => {
        const items = itemsByFolder.get(folder.id) ?? [];
        // Views are device-local and have no workspace id; archived workspaces no longer show.
        const workspaceIds = items
          .filter(
            (itemKey) =>
              !isBoardFolderItemKey(itemKey) &&
              (!activeWorkspaceIds || activeWorkspaceIds.has(itemKey)),
          )
          .sort();
        return {
          id: folder.id,
          name: folder.name,
          emoji: folder.emoji,
          order: folder.order,
          itemCount: items.length,
          workspaceIds,
        };
      });
      const unfiledWorkspaceIds = activeWorkspaceIds
        ? [...activeWorkspaceIds].filter((workspaceId) => !(workspaceId in membership)).sort()
        : undefined;
      return {
        content: [],
        structuredContent: ensureValidJson({
          folders: result,
          ...(unfiledWorkspaceIds ? { unfiledWorkspaceIds } : {}),
        }),
      };
    },
  );

  registerTool(
    "create_folder",
    {
      title: "Create folder",
      description:
        "Create a sidebar folder for workspaces. Names are unique, ignoring case. Fails if the name is taken: use set_workspace_folder with createIfMissing to reuse or create in one step.",
      inputSchema: {
        name: z.string().trim().min(1, "name is required").max(FOLDER_NAME_MAX_LENGTH),
        emoji: z
          .string()
          .trim()
          .max(FOLDER_EMOJI_MAX_LENGTH)
          .optional()
          .describe("Optional emoji shown before the name."),
      },
      outputSchema: { folder: FolderSummarySchema },
    },
    async ({ name, emoji }) => {
      const folder = await translateFolderErrors(() => registry.createFolder({ name, emoji }));
      return {
        content: [],
        structuredContent: ensureValidJson({ folder: summarize(folder) }),
      };
    },
  );

  registerTool(
    "set_workspace_folder",
    {
      title: "Set workspace folder",
      description:
        "Put workspaces in a sidebar folder, or take them out of folders (folder null = Unfiled). Pass many workspaceIds to sort a whole batch in one call. A workspace is in at most one folder.",
      inputSchema: {
        workspaceIds: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("Workspace ids to file. Use this for batches."),
        workspaceId: z.string().trim().min(1).optional().describe("A single workspace id."),
        folder: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .describe("Folder id or name (any case). Null moves the workspaces to Unfiled."),
        createIfMissing: z
          .boolean()
          .optional()
          .describe("Create the folder from `folder` as its name when none matches."),
      },
      outputSchema: {
        folderId: z.string().nullable(),
        folderName: z.string().nullable(),
        created: z.boolean(),
        assigned: z.array(z.string()),
      },
    },
    async ({ workspaceIds, workspaceId, folder, createIfMissing }) => {
      const ids = [...new Set([...(workspaceIds ?? []), ...(workspaceId ? [workspaceId] : [])])];
      if (ids.length === 0) {
        throw new PaseoToolInputError("Pass workspaceIds (or workspaceId)");
      }
      await assertWorkspacesExist(ids);
      const { target, created } =
        folder === null
          ? { target: null, created: false }
          : await resolveTargetFolder(folder, createIfMissing === true);

      const targetFolderId = target?.id ?? null;
      const assigned = await translateFolderErrors(() => registry.assignItems(ids, targetFolderId));
      return {
        content: [],
        structuredContent: ensureValidJson({
          folderId: targetFolderId,
          folderName: target?.name ?? null,
          created,
          assigned,
        }),
      };
    },
  );
}

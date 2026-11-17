import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PaseoToolInputError,
  type PaseoToolConfig,
  type PaseoToolDefinition,
} from "../agent/tools/types.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedWorkspaceRecord,
} from "../workspace-registry.js";
import { createFolderRegistry, type FileBackedFolderRegistry } from "./folder-registry.js";
import { registerFolderTools } from "./folder-tools.js";

const logger = createTestLogger();

let home: string;
let registry: FileBackedFolderRegistry;
let tools: Map<string, PaseoToolDefinition>;

function workspace(
  workspaceId: string,
  archivedAt: string | null = null,
): PersistedWorkspaceRecord {
  return createPersistedWorkspaceRecord({
    workspaceId,
    projectId: "proj_1",
    cwd: `/repo/${workspaceId}`,
    kind: "directory",
    displayName: workspaceId,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt,
  });
}

function register(workspaces: PersistedWorkspaceRecord[] | null): void {
  tools = new Map();
  const byId = new Map((workspaces ?? []).map((record) => [record.workspaceId, record]));
  registerFolderTools({
    registerTool: (name: string, config: PaseoToolConfig, handler) => {
      tools.set(name, {
        name,
        title: config.title,
        description: config.description ?? name,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        handler,
      });
    },
    registry,
    ...(workspaces
      ? {
          workspaceRegistry: {
            get: async (id: string) => byId.get(id) ?? null,
            list: async () => [...byId.values()],
          },
        }
      : {}),
  });
}

async function call(name: string, input: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.handler(input, {});
  return result.structuredContent as Record<string, unknown>;
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "paseo-folder-tools-"));
  registry = createFolderRegistry(home, logger);
  register([workspace("wks_a"), workspace("wks_b"), workspace("wks_c"), workspace("wks_old", "x")]);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("folder MCP tools", () => {
  it("registers list_folders, create_folder and set_workspace_folder with agent-readable descriptions", () => {
    expect([...tools.keys()].sort()).toEqual([
      "create_folder",
      "list_folders",
      "set_workspace_folder",
    ]);
    for (const tool of tools.values()) expect(tool.description.length).toBeGreaterThan(40);
  });

  it("create_folder makes a folder and refuses a taken name", async () => {
    const created = await call("create_folder", { name: "Faith", emoji: "🕌" });
    expect(created).toMatchObject({ folder: { name: "Faith", emoji: "🕌", order: 0 } });

    await expect(call("create_folder", { name: "faith" })).rejects.toBeInstanceOf(
      PaseoToolInputError,
    );
  });

  it("set_workspace_folder files a whole batch in one call, by folder name in any case", async () => {
    await call("create_folder", { name: "Faith" });

    const result = await call("set_workspace_folder", {
      workspaceIds: ["wks_a", "wks_b"],
      workspaceId: "wks_c",
      folder: "fAITH",
    });

    expect(result).toMatchObject({
      folderName: "Faith",
      created: false,
      assigned: ["wks_a", "wks_b", "wks_c"],
    });
    const { folders } = await registry.getSnapshot();
    expect((await registry.getSnapshot()).membership).toEqual({
      wks_a: folders[0]?.id,
      wks_b: folders[0]?.id,
      wks_c: folders[0]?.id,
    });
  });

  it("set_workspace_folder takes a folder id as well as a name", async () => {
    const { folder } = (await call("create_folder", { name: "Work" })) as {
      folder: { id: string };
    };

    await call("set_workspace_folder", { workspaceId: "wks_a", folder: folder.id });

    expect((await registry.getSnapshot()).membership).toEqual({ wks_a: folder.id });
  });

  it("set_workspace_folder with an unknown folder fails, or creates it with createIfMissing", async () => {
    await expect(
      call("set_workspace_folder", { workspaceId: "wks_a", folder: "Nope" }),
    ).rejects.toThrow("Folder not found: Nope");
    expect((await registry.getSnapshot()).folders).toEqual([]);

    const created = await call("set_workspace_folder", {
      workspaceIds: ["wks_a", "wks_b"],
      folder: "Nope",
      createIfMissing: true,
    });
    expect(created).toMatchObject({ folderName: "Nope", created: true });
    // The second time it finds the folder it made.
    const again = await call("set_workspace_folder", {
      workspaceId: "wks_c",
      folder: "nope",
      createIfMissing: true,
    });
    expect(again).toMatchObject({ folderName: "Nope", created: false });
    expect((await registry.getSnapshot()).folders).toHaveLength(1);
  });

  it("createIfMissing never invents a folder from something that looks like a folder id", async () => {
    await expect(
      call("set_workspace_folder", {
        workspaceId: "wks_a",
        folder: "fld_0123456789abcdef",
        createIfMissing: true,
      }),
    ).rejects.toThrow("Folder not found");
    expect((await registry.getSnapshot()).folders).toEqual([]);
  });

  it("set_workspace_folder with folder null sends workspaces to Unfiled", async () => {
    await call("set_workspace_folder", {
      workspaceIds: ["wks_a", "wks_b"],
      folder: "Faith",
      createIfMissing: true,
    });

    const result = await call("set_workspace_folder", { workspaceId: "wks_a", folder: null });

    expect(result).toMatchObject({ folderId: null, folderName: null, assigned: ["wks_a"] });
    expect(Object.keys((await registry.getSnapshot()).membership)).toEqual(["wks_b"]);
  });

  it("set_workspace_folder is all or nothing: one unknown workspace files none", async () => {
    await call("create_folder", { name: "Faith" });

    await expect(
      call("set_workspace_folder", { workspaceIds: ["wks_a", "wks_typo"], folder: "Faith" }),
    ).rejects.toThrow("Workspace not found: wks_typo");
    await expect(call("set_workspace_folder", { folder: "Faith" })).rejects.toThrow(
      PaseoToolInputError,
    );

    expect((await registry.getSnapshot()).membership).toEqual({});
  });

  it("list_folders counts items, lists workspace ids, and names what is still Unfiled", async () => {
    await call("set_workspace_folder", {
      workspaceIds: ["wks_a", "wks_old"],
      folder: "Faith",
      createIfMissing: true,
    });
    const { folders } = await registry.getSnapshot();
    await registry.assignItems(["board:b1"], folders[0]?.id ?? null);
    await call("create_folder", { name: "Empty", emoji: "📭" });

    const listed = await call("list_folders", {});

    expect(listed).toEqual({
      folders: [
        {
          id: folders[0]?.id,
          name: "Faith",
          emoji: null,
          order: 0,
          // The view and the archived workspace count as items; only the live workspace is listed.
          itemCount: 3,
          workspaceIds: ["wks_a"],
        },
        expect.objectContaining({ name: "Empty", emoji: "📭", itemCount: 0, workspaceIds: [] }),
      ],
      unfiledWorkspaceIds: ["wks_b", "wks_c"],
    });
  });

  it("without a workspace registry it still lists folders and skips the unfiled list", async () => {
    register(null);
    await call("create_folder", { name: "Faith" });
    await registry.assignItems(["wks_a"], (await registry.getSnapshot()).folders[0]?.id ?? null);

    const listed = await call("list_folders", {});

    expect(listed).not.toHaveProperty("unfiledWorkspaceIds");
    expect(listed).toMatchObject({ folders: [{ itemCount: 1, workspaceIds: ["wks_a"] }] });
  });
});

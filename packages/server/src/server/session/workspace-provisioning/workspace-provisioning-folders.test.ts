import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createNoopWorkspaceGitService } from "../../test-utils/workspace-git-service-stub.js";
import {
  createFolderRegistry,
  type FileBackedFolderRegistry,
} from "../../folders/folder-registry.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
} from "../../workspace-registry.js";
import {
  createWorkspaceProvisioningService,
  type WorkspaceProvisioningService,
} from "./workspace-provisioning-service.js";

// Nazmul mod (folders): a workspace made from a caller's workspace lands in the caller's folder.

const logger = createTestLogger();

let tmpDir: string;
let folders: FileBackedFolderRegistry;
let provisioning: WorkspaceProvisioningService;

async function membership() {
  return (await folders.getSnapshot()).membership;
}

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "workspace-provisioning-folders-"));
  folders = createFolderRegistry(tmpDir, logger);
  const workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(tmpDir, "projects", "workspaces.json"),
    logger,
  );
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(tmpDir, "projects", "projects.json"),
    logger,
  );
  await workspaceRegistry.initialize();
  await projectRegistry.initialize();
  provisioning = createWorkspaceProvisioningService({
    workspaceRegistry,
    projectRegistry,
    workspaceGitService: createNoopWorkspaceGitService(),
    isDirectory: async () => true,
    logger,
    folders,
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("a directory workspace made by an agent lands in the agent's folder", async () => {
  const dir = path.join(tmpDir, "plain");
  const faith = await folders.createFolder({ name: "Faith" });
  const parent = await provisioning.createWorkspaceForDirectory(dir);
  await folders.assignItems([parent.workspaceId], faith.id);

  const child = await provisioning.createWorkspaceForDirectory(dir, null, undefined, {
    callerWorkspaceId: parent.workspaceId,
  });

  expect(await membership()).toEqual({
    [parent.workspaceId]: faith.id,
    [child.workspaceId]: faith.id,
  });
});

test("a background workspace gets the folder too, and an explicit one is still filed", async () => {
  const dir = path.join(tmpDir, "plain");
  const faith = await folders.createFolder({ name: "Faith" });
  const parent = await provisioning.createWorkspaceForDirectory(dir);
  await folders.assignItems([parent.workspaceId], faith.id);

  const background = await provisioning.createWorkspaceForDirectory(dir, null, undefined, {
    callerWorkspaceId: parent.workspaceId,
    background: true,
  });
  const visible = await provisioning.createWorkspaceForDirectory(dir, null, undefined, {
    callerWorkspaceId: parent.workspaceId,
    background: false,
  });

  expect(background.background).toBe(true);
  expect(visible.background).toBe(false);
  expect(await membership()).toMatchObject({
    [background.workspaceId]: faith.id,
    [visible.workspaceId]: faith.id,
  });
});

test("a worktree workspace made by an agent lands in the agent's folder", async () => {
  const repo = path.join(tmpDir, "repo");
  const worktree = path.join(tmpDir, "worktrees", "feature");
  const faith = await folders.createFolder({ name: "Faith" });
  const parent = await provisioning.createWorkspaceForDirectory(repo);
  await folders.assignItems([parent.workspaceId], faith.id);

  const child = await provisioning.createWorkspaceForWorktree({
    sourceCwd: repo,
    repoRoot: repo,
    cwd: worktree,
    worktreeRoot: worktree,
    branch: "feature",
    baseBranch: "main",
    title: null,
    callerWorkspaceId: parent.workspaceId,
  });

  expect((await membership())[child.workspaceId]).toBe(faith.id);
});

test("a workspace the user makes, or one made from an unfiled workspace, stays unfiled", async () => {
  const dir = path.join(tmpDir, "plain");
  const faith = await folders.createFolder({ name: "Faith" });
  const filed = await provisioning.createWorkspaceForDirectory(dir);
  await folders.assignItems([filed.workspaceId], faith.id);
  const unfiledParent = await provisioning.createWorkspaceForDirectory(dir);

  await provisioning.createWorkspaceForDirectory(dir);
  await provisioning.createWorkspaceForDirectory(dir, null, undefined, {
    callerWorkspaceId: unfiledParent.workspaceId,
  });

  expect(await membership()).toEqual({ [filed.workspaceId]: faith.id });
});

test("a folder failure never fails the workspace", async () => {
  const dir = path.join(tmpDir, "plain");
  const parent = await provisioning.createWorkspaceForDirectory(dir);
  const failing = createWorkspaceProvisioningService({
    workspaceRegistry: new FileBackedWorkspaceRegistry(
      path.join(tmpDir, "projects", "workspaces.json"),
      logger,
    ),
    projectRegistry: new FileBackedProjectRegistry(
      path.join(tmpDir, "projects", "projects.json"),
      logger,
    ),
    workspaceGitService: createNoopWorkspaceGitService(),
    isDirectory: async () => true,
    logger,
    folders: {
      inheritFolder: async () => {
        throw new Error("disk full");
      },
    },
  });

  const child = await failing.createWorkspaceForDirectory(dir, null, undefined, {
    callerWorkspaceId: parent.workspaceId,
  });

  expect(child.workspaceId).toMatch(/^wks_/);
});

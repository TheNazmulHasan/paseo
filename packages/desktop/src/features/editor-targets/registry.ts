import type {
  EditorTarget,
  EditorTargetDescriptor,
  EditorTargetLaunchInput,
  EditorTargetRuntime,
} from "./target.js";
import { androidStudioTarget } from "./targets/android-studio.js";
import { antigravityTarget } from "./targets/antigravity.js";
import { aquaTarget } from "./targets/aqua.js";
import { clionTarget } from "./targets/clion.js";
import { cursorTarget } from "./targets/cursor.js";
import { datagripTarget } from "./targets/datagrip.js";
import { dataspellTarget } from "./targets/dataspell.js";
import { explorerTarget, fileManagerTarget, finderTarget } from "./targets/file-manager.js";
import { golandTarget } from "./targets/goland.js";
import { intellijIdeaTarget } from "./targets/intellij-idea.js";
import { kiroTarget } from "./targets/kiro.js";
import { phpstormTarget } from "./targets/phpstorm.js";
import { pycharmTarget } from "./targets/pycharm.js";
import { riderTarget } from "./targets/rider.js";
import { rubymineTarget } from "./targets/rubymine.js";
import { rustroverTarget } from "./targets/rustrover.js";
import { traeTarget } from "./targets/trae.js";
import { vscodiumTarget } from "./targets/vscodium.js";
import { vscodeInsidersTarget } from "./targets/vscode-insiders.js";
import { vscodeTarget } from "./targets/vscode.js";
import { webstormTarget } from "./targets/webstorm.js";
import { zedTarget } from "./targets/zed.js";

export const EDITOR_TARGETS: readonly EditorTarget[] = [
  cursorTarget,
  traeTarget,
  kiroTarget,
  vscodeTarget,
  vscodeInsidersTarget,
  vscodiumTarget,
  zedTarget,
  antigravityTarget,
  androidStudioTarget,
  intellijIdeaTarget,
  aquaTarget,
  clionTarget,
  datagripTarget,
  dataspellTarget,
  golandTarget,
  phpstormTarget,
  pycharmTarget,
  riderTarget,
  rubymineTarget,
  rustroverTarget,
  webstormTarget,
  finderTarget,
  explorerTarget,
  fileManagerTarget,
];

export async function listAvailableEditorTargets(
  runtime: EditorTargetRuntime,
  targets: readonly EditorTarget[] = EDITOR_TARGETS,
): Promise<EditorTargetDescriptor[]> {
  const descriptors: EditorTargetDescriptor[] = [];
  for (const target of targets) {
    if (await target.isInstalled(runtime)) {
      descriptors.push(await target.describe(runtime));
    }
  }
  return descriptors;
}

export function getEditorTarget(
  id: string,
  targets: readonly EditorTarget[] = EDITOR_TARGETS,
): EditorTarget {
  const target = targets.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown editor target: ${id}`);
  return target;
}

/**
 * Chat replies often write paths as `~/…`. Finder/Explorer need a real absolute path, so expand
 * the leading tilde against the runtime's home directory before validation.
 */
export function expandHomePath(targetPath: string, runtime: EditorTargetRuntime): string {
  if (targetPath !== "~" && !targetPath.startsWith("~/") && !targetPath.startsWith("~\\")) {
    return targetPath;
  }
  const home = runtime.env.HOME ?? runtime.env.USERPROFILE;
  if (!home) return targetPath;
  const trimmedHome = home.replace(/[\\/]+$/, "");
  return targetPath === "~" ? trimmedHome : `${trimmedHome}${targetPath.slice(1)}`;
}

export async function openEditorTarget(
  rawInput: EditorTargetLaunchInput & { editorId: string },
  runtime: EditorTargetRuntime,
  targets: readonly EditorTarget[] = EDITOR_TARGETS,
): Promise<void> {
  const input = {
    ...rawInput,
    workspacePath: expandHomePath(rawInput.workspacePath, runtime),
    filePath: rawInput.filePath ? expandHomePath(rawInput.filePath, runtime) : undefined,
  };
  if (!runtime.isAbsolutePath(input.workspacePath)) {
    throw new Error("Editor target workspace path must be an absolute local path");
  }
  if (!runtime.pathExists(input.workspacePath)) {
    throw new Error(`Path does not exist: ${input.workspacePath}`);
  }
  if (input.filePath) {
    if (!runtime.isAbsolutePath(input.filePath)) {
      throw new Error("Editor target file path must be an absolute local path");
    }
    if (!runtime.pathExists(input.filePath)) {
      throw new Error(`Path does not exist: ${input.filePath}`);
    }
  }

  const target = getEditorTarget(input.editorId, targets);
  if (!(await target.isInstalled(runtime))) {
    const descriptor = await target.describe(runtime);
    throw new Error(`Editor target unavailable: ${descriptor.label}`);
  }
  await target.launch(input, runtime);
}

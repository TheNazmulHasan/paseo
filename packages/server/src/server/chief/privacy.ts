import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Nazmul mod (chief): which sessions must never have their text returned by `search_sessions`.
 *
 * Mirrors the privacy-block plugin's rules (myos/paseo/privacy-block.md; the plugin itself is
 * not imported, so it can change without touching the fork):
 * A workspace is private when ANY of these holds:
 * 1. its id is in `<paseoHome>/chief.json` `privateWorkspaceIds` (e.g. the family Health
 *    workspaces, whose cwd is an ordinary folder no marker can cover);
 * 2. its title is "Debrief" (the built-in id of that workspace is kept too);
 * 3. its cwd is inside a folder that holds a `.local-only` marker file, or inside a folder whose
 *    name contains "(local-only)" (both the lexical path and its realpath are walked).
 * `.private-project` is NOT a marker: the exam/ study material may go through the proxy pool.
 * - never private: `/private/tmp/anon-*` and `/tmp/anon-*`, the sanctioned place for anonymised
 *   copies, even if a marker was copied in.
 *
 * Why it exists: Chief's answers travel through whatever model serves it, and a snippet of a
 * private session in a tool result leaves the machine with that route. One switch lifts it:
 * `<paseoHome>/chief.json` `{ "searchPrivateText": true }`.
 */

export const PRIVATE_MARKER_FILES = [".local-only"] as const;

/** A folder whose name contains this is local-only, with or without a marker file. */
export const PRIVATE_FOLDER_NAME_TOKEN = "(local-only)";

/** Workspaces with this title are private, whatever their cwd. */
export const PRIVATE_WORKSPACE_TITLE = "debrief";

/** Debrief (Protocol9): cwd is exam/, but it works only on the personal folder. */
export const BUILTIN_PRIVATE_WORKSPACE_IDS = ["wks_234bcdec1e111677"] as const;

export const SANCTIONED_PREFIXES = ["/private/tmp/anon-", "/tmp/anon-"] as const;

export const PRIVATE_TEXT_WITHHELD = "(private workspace — text withheld)";

export interface ChiefConfig {
  /** When false (the default) no snippet from a private workspace is ever returned. */
  searchPrivateText: boolean;
  /** Workspace ids to treat as private, on top of the built-in Debrief id. */
  privateWorkspaceIds: string[];
}

const DEFAULT_CONFIG: ChiefConfig = { searchPrivateText: false, privateWorkspaceIds: [] };

/** Reads `<paseoHome>/chief.json`. A missing or unreadable file means the safe defaults. */
export function readChiefConfig(paseoHome: string | undefined): ChiefConfig {
  if (!paseoHome) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(join(paseoHome, "chief.json"), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
    const record = raw as Record<string, unknown>;
    return {
      // Only a literal `true` lifts the guard; anything else keeps it on.
      searchPrivateText: record.searchPrivateText === true,
      privateWorkspaceIds: Array.isArray(record.privateWorkspaceIds)
        ? record.privateWorkspaceIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function candidatePaths(cwd: string): string[] {
  const abs = resolve(cwd);
  const paths = [abs];
  try {
    const real = realpathSync(abs);
    if (real !== abs) paths.push(real);
  } catch {
    // The folder may be gone; the lexical path is still checked.
  }
  return paths;
}

export interface PrivacyCheck {
  isPrivate: boolean;
  reason: string;
}

export interface PrivacyGuard {
  check(input: {
    workspaceId?: string | null;
    workspaceTitle?: string | null;
    cwds: readonly (string | null | undefined)[] }): PrivacyCheck;
}

export function createPrivacyGuard(options: {
  config: ChiefConfig;
  /** Test seam; defaults to `fs.existsSync`. */
  markerExists?: (path: string) => boolean;
}): PrivacyGuard {
  const markerExists = options.markerExists ?? existsSync;
  const privateIds = new Set<string>([
    ...BUILTIN_PRIVATE_WORKSPACE_IDS,
    ...options.config.privateWorkspaceIds,
  ]);
  const cwdCache = new Map<string, PrivacyCheck>();

  function checkCwd(cwd: string): PrivacyCheck {
    const cached = cwdCache.get(cwd);
    if (cached) return cached;
    const result = computeCwd(cwd);
    cwdCache.set(cwd, result);
    return result;
  }

  function computeCwd(cwd: string): PrivacyCheck {
    const paths = candidatePaths(cwd);
    for (const path of paths) {
      if (SANCTIONED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        return { isPrivate: false, reason: "sanctioned anonymised dir" };
      }
    }
    for (const path of paths) {
      let dir = path;
      for (;;) {
        if (basename(dir).toLowerCase().includes(PRIVATE_FOLDER_NAME_TOKEN)) {
          return { isPrivate: true, reason: `folder name ${basename(dir)}` };
        }
        for (const marker of PRIVATE_MARKER_FILES) {
          const candidate = join(dir, marker);
          if (markerExists(candidate)) {
            return { isPrivate: true, reason: `marker ${candidate}` };
          }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    return { isPrivate: false, reason: "no marker above cwd" };
  }

  return {
    check({ workspaceId, workspaceTitle, cwds }) {
      if (workspaceId && privateIds.has(workspaceId)) {
        return { isPrivate: true, reason: `private workspace ${workspaceId}` };
      }
      if (workspaceTitle?.trim().toLowerCase() === PRIVATE_WORKSPACE_TITLE) {
        return { isPrivate: true, reason: "workspace titled Debrief" };
      }
      for (const cwd of cwds) {
        if (!cwd) continue;
        const result = checkCwd(cwd);
        if (result.isPrivate) return result;
      }
      return { isPrivate: false, reason: "not private" };
    },
  };
}

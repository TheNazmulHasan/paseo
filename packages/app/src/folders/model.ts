// Folders (fork mod #16): user-made one-level folders that hold workspaces and saved views.
// Everything here is pure so the sidebar projection, the picker, the landing rule and the tests
// share one definition of "which item is in which folder".
import {
  boardFolderItemKey,
  folderNameKey,
  isBoardFolderItemKey,
  sortFolders,
  type FoldersSnapshot,
} from "@getpaseo/protocol/folders";

/** Unfiled is built in: never stored on a daemon, so it has no folder id, only this section key. */
export const UNFILED_FOLDER_KEY = "__unfiled__";

/** How long a "+ on a folder" choice waits for its workspace before it is forgotten. */
export const EXPLICIT_FOLDER_TTL_MS = 10 * 60 * 1000;

/** What a folder row, the picker and the move actions point at: one workspace or one view. */
export type FolderItemRef =
  | { kind: "workspace"; serverId: string; workspaceId: string }
  | { kind: "board"; boardId: string };

export interface FolderHostSnapshot {
  serverId: string;
  snapshot: FoldersSnapshot;
}

export interface FolderMember {
  serverId: string;
  folderId: string;
}

/**
 * One folder as the sidebar shows it. Every host keeps its own folders, so folders with the same
 * name (case-insensitive) on different hosts are one group; `members` says which host holds which
 * folder id. `key` is the lower-cased name, which is also what remembers a fold across a Delete
 * and Undo (Undo re-creates the folder with a new id).
 */
export interface FolderGroup {
  key: string;
  name: string;
  emoji: string | null;
  order: number;
  members: FolderMember[];
}

export interface FolderIndex {
  groups: FolderGroup[];
  /** `<serverId>:<workspaceId>` -> group key; absent = Unfiled. */
  workspaceFolderKey: ReadonlyMap<string, string>;
  /** boardId -> group key; absent = Unfiled. */
  boardFolderKey: ReadonlyMap<string, string>;
  /** Hosts whose first snapshot has arrived. */
  loadedServerIds: ReadonlySet<string>;
}

export const EMPTY_FOLDER_INDEX: FolderIndex = {
  groups: [],
  workspaceFolderKey: new Map(),
  boardFolderKey: new Map(),
  loadedServerIds: new Set(),
};

export function workspaceItemKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

/** The key the daemon files an item under: a workspace's own id, or `board:<id>` for a view. */
export function daemonItemKey(item: FolderItemRef): string {
  return item.kind === "workspace" ? item.workspaceId : boardFolderItemKey(item.boardId);
}

export function buildFolderIndex(hosts: readonly FolderHostSnapshot[]): FolderIndex {
  const groupsByKey = new Map<string, FolderGroup>();
  const groupKeyByHostFolder = new Map<string, string>();
  for (const host of hosts) {
    for (const folder of sortFolders(host.snapshot.folders)) {
      const key = folderNameKey(folder.name);
      if (!key) continue;
      const existing = groupsByKey.get(key);
      if (existing) {
        existing.members.push({ serverId: host.serverId, folderId: folder.id });
        existing.order = Math.min(existing.order, folder.order);
        existing.emoji ??= folder.emoji;
      } else {
        groupsByKey.set(key, {
          key,
          name: folder.name,
          emoji: folder.emoji,
          order: folder.order,
          members: [{ serverId: host.serverId, folderId: folder.id }],
        });
      }
      groupKeyByHostFolder.set(`${host.serverId}\u0000${folder.id}`, key);
    }
  }
  const workspaceFolderKey = new Map<string, string>();
  const boardFolderKey = new Map<string, string>();
  for (const host of hosts) {
    for (const [itemKey, folderId] of Object.entries(host.snapshot.membership)) {
      const groupKey = groupKeyByHostFolder.get(`${host.serverId}\u0000${folderId}`);
      if (!groupKey) continue;
      if (isBoardFolderItemKey(itemKey)) {
        const boardId = itemKey.slice("board:".length);
        if (!boardFolderKey.has(boardId)) boardFolderKey.set(boardId, groupKey);
      } else {
        workspaceFolderKey.set(workspaceItemKey(host.serverId, itemKey), groupKey);
      }
    }
  }
  return {
    groups: [...groupsByKey.values()].sort(
      (a, b) => a.order - b.order || a.key.localeCompare(b.key),
    ),
    workspaceFolderKey,
    boardFolderKey,
    loadedServerIds: new Set(hosts.map((host) => host.serverId)),
  };
}

/** The group key an item is filed under, or null when it is Unfiled. */
export function folderKeyOfItem(index: FolderIndex, item: FolderItemRef): string | null {
  return item.kind === "workspace"
    ? (index.workspaceFolderKey.get(workspaceItemKey(item.serverId, item.workspaceId)) ?? null)
    : (index.boardFolderKey.get(item.boardId) ?? null);
}

// ---------------------------------------------------------------------------------------------
// Sections: what the sidebar renders
// ---------------------------------------------------------------------------------------------

export interface FolderSection<W, B> {
  /** The group key, or `UNFILED_FOLDER_KEY`. */
  key: string;
  /** Null for Unfiled. */
  group: FolderGroup | null;
  boards: B[];
  workspaces: W[];
  /** Views plus workspaces: what the header counts. */
  count: number;
  /**
   * The workspaces whose Cmd+1..9 number is shown in this section: the ones not already numbered
   * by Pinned, the Desk or an earlier folder. Filled in by the projection, which knows what is open.
   */
  numberedKeys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * One section per folder in folder order, then Unfiled. A folder lists everything filed in it, so a
 * workspace that is also on the Desk or Pinned shows here too. `workspaces` arrive in display order
 * (latest activity first) and keep it. Membership of a folder the host no longer has counts as
 * Unfiled; membership of an item the app does not know never appears (only known items are listed).
 */
export function buildFolderSections<
  W extends { workspaceKey: string },
  B extends { id: string },
>(input: {
  index: FolderIndex;
  workspaces: readonly W[];
  boards: readonly B[];
}): FolderSection<W, B>[] {
  const { index } = input;
  const byKey = new Map<string, FolderSection<W, B>>();
  const sections: FolderSection<W, B>[] = index.groups.map((group) => {
    const section: FolderSection<W, B> = {
      key: group.key,
      group,
      boards: [],
      workspaces: [],
      count: 0,
      numberedKeys: NO_KEYS,
    };
    byKey.set(group.key, section);
    return section;
  });
  const unfiled: FolderSection<W, B> = {
    key: UNFILED_FOLDER_KEY,
    group: null,
    boards: [],
    workspaces: [],
    count: 0,
    numberedKeys: NO_KEYS,
  };
  for (const board of input.boards) {
    const section = byKey.get(index.boardFolderKey.get(board.id) ?? "") ?? unfiled;
    section.boards.push(board);
  }
  for (const workspace of input.workspaces) {
    const section =
      byKey.get(index.workspaceFolderKey.get(workspace.workspaceKey) ?? "") ?? unfiled;
    section.workspaces.push(workspace);
  }
  const all = [...sections, unfiled];
  for (const section of all) {
    section.count = section.boards.length + section.workspaces.length;
  }
  return all;
}

/**
 * The Cmd+1..9 sections for the folders: rows of open folders, after the Desk. A workspace that an
 * earlier section already numbered (Pinned, Desk) or an earlier open folder numbered is numbered
 * once, at that first place. A first place that is folded away numbers nothing, so the row is
 * numbered where it is actually visible.
 */
export function buildFolderShortcutSections<W extends { workspaceKey: string }>(input: {
  sections: readonly { key: string; workspaces: readonly W[] }[];
  openKeys: ReadonlySet<string>;
  sectionCollapsed: boolean;
  alreadyNumbered: ReadonlySet<string>;
}): Array<{ workspaces: readonly W[]; collapsed: boolean }> {
  const numbered = new Set(input.alreadyNumbered);
  return input.sections.map((section) => {
    const collapsed = input.sectionCollapsed || !input.openKeys.has(section.key);
    if (collapsed) {
      return { workspaces: [], collapsed: true };
    }
    const fresh = section.workspaces.filter((workspace) => !numbered.has(workspace.workspaceKey));
    for (const workspace of fresh) numbered.add(workspace.workspaceKey);
    return { workspaces: fresh, collapsed: false };
  });
}

// ---------------------------------------------------------------------------------------------
// Names: "🕌 Faith" is one box for both the emoji and the name
// ---------------------------------------------------------------------------------------------

const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*/u;

/** A leading emoji is the folder's emoji; the rest is its name. No emoji = none. */
export function parseFolderNameInput(raw: string): { name: string; emoji: string | null } {
  const trimmed = raw.trim();
  const match = LEADING_EMOJI.exec(trimmed);
  if (!match) {
    return { name: trimmed, emoji: null };
  }
  return { name: trimmed.slice(match[0].length).trim(), emoji: match[1] };
}

/** What the inline rename box starts with: the emoji, a space, the name. */
export function formatFolderNameInput(folder: { name: string; emoji: string | null }): string {
  return folder.emoji ? `${folder.emoji} ${folder.name}` : folder.name;
}

// ---------------------------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------------------------

export type FolderPickerOption =
  | { kind: "folder"; key: string; name: string; emoji: string | null; current: boolean }
  | { kind: "unfiled"; key: typeof UNFILED_FOLDER_KEY; current: boolean }
  | { kind: "create"; key: "__create__"; name: string; emoji: string | null };

function matchesQuery(text: string, tokens: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

/**
 * Folders that match the typed words (every word, anywhere in the name), then Unfiled, then a
 * "Create" row for a name that no folder already has. Nothing typed lists every folder and Unfiled.
 */
export function buildFolderPickerOptions(input: {
  groups: readonly FolderGroup[];
  query: string;
  /** The group key the item sits in now; null when Unfiled. */
  currentFolderKey: string | null;
  unfiledLabel: string;
}): FolderPickerOption[] {
  const { name: typedName, emoji: typedEmoji } = parseFolderNameInput(input.query);
  const tokens = typedName.toLowerCase().split(/\s+/).filter(Boolean);
  const options: FolderPickerOption[] = [];
  for (const group of input.groups) {
    if (matchesQuery(group.name, tokens)) {
      options.push({
        kind: "folder",
        key: group.key,
        name: group.name,
        emoji: group.emoji,
        current: group.key === input.currentFolderKey,
      });
    }
  }
  if (matchesQuery(input.unfiledLabel, tokens)) {
    options.push({
      kind: "unfiled",
      key: UNFILED_FOLDER_KEY,
      current: input.currentFolderKey === null,
    });
  }
  const typedKey = folderNameKey(typedName);
  if (typedKey && !input.groups.some((group) => group.key === typedKey)) {
    options.push({ kind: "create", key: "__create__", name: typedName, emoji: typedEmoji });
  }
  return options;
}

// ---------------------------------------------------------------------------------------------
// New workspace lands in "where I was"
// ---------------------------------------------------------------------------------------------

export interface PlaceVisit {
  serverId: string;
  workspaceId: string;
}

/** Board visits share the switcher history under this pseudo host (`workspace-switcher/model.ts`). */
const BOARD_VISIT_SERVER_ID = "board";

/** The most recent place that is not the new workspace itself (history is newest first). */
export function pickPreviousPlace(
  history: readonly PlaceVisit[],
  excludeWorkspaceKey: string,
): FolderItemRef | null {
  for (const visit of history) {
    if (workspaceItemKey(visit.serverId, visit.workspaceId) === excludeWorkspaceKey) continue;
    return visit.serverId === BOARD_VISIT_SERVER_ID
      ? { kind: "board", boardId: visit.workspaceId }
      : { kind: "workspace", serverId: visit.serverId, workspaceId: visit.workspaceId };
  }
  return null;
}

export interface ExplicitFolderChoice {
  folderKey: string;
  at: number;
}

/** A "+ on a folder" choice that is still fresh, else null. */
export function activeExplicitFolderKey(
  choice: ExplicitFolderChoice | null,
  now: number,
): string | null {
  return choice && now - choice.at <= EXPLICIT_FOLDER_TTL_MS ? choice.folderKey : null;
}

export interface FolderFilingPlan {
  serverId: string;
  workspaceId: string;
  folderKey: string;
}

/**
 * Which brand-new workspaces to file, and where. A workspace that already has a folder is left
 * alone (agent-created ones are filed by the daemon before they appear), and so is any workspace
 * on a host whose folders have not loaded: not knowing is not the same as Unfiled. The folder is
 * the one the user picked with + (when fresh), else the folder of the place they were in; if that
 * place is Unfiled there is nothing to do.
 */
export function planNewWorkspaceFiling(input: {
  landedKeys: readonly string[];
  index: FolderIndex;
  history: readonly PlaceVisit[];
  explicitFolderKey: string | null;
}): { plans: FolderFilingPlan[]; usedExplicit: boolean } {
  const plans: FolderFilingPlan[] = [];
  let usedExplicit = false;
  for (const key of input.landedKeys) {
    const cut = key.lastIndexOf(":");
    if (cut <= 0) continue;
    const serverId = key.slice(0, cut);
    const workspaceId = key.slice(cut + 1);
    if (!input.index.loadedServerIds.has(serverId) || input.index.workspaceFolderKey.has(key)) {
      continue;
    }
    let folderKey = input.explicitFolderKey;
    if (folderKey) {
      usedExplicit = true;
    } else {
      const previous = pickPreviousPlace(input.history, key);
      folderKey = previous ? folderKeyOfItem(input.index, previous) : null;
    }
    if (!folderKey || !input.index.groups.some((group) => group.key === folderKey)) continue;
    plans.push({ serverId, workspaceId, folderKey });
  }
  return { plans, usedExplicit };
}

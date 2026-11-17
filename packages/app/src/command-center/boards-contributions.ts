import type { BoardSummary } from "@/boards/types";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface BoardsCommandCenterSource {
  labels: {
    section: string;
    split: string;
    openView(name: string): string;
  };
  icons: {
    split?: CommandCenterIcon;
    view?: CommandCenterIcon;
  };
  shortcuts: { split?: ShortcutKey[][] };
  /** Every saved split, as the sidebar lists them. */
  views: readonly BoardSummary[];
  openSplitPicker(): void;
  openView(boardId: string): void;
}

const GROUP = "views";

/**
 * Fork mod #13 (Boards): "Split workspaces…" and one "Open view: <name>" per saved split. They work from any route, so they live in their own source, not the workspace one
 * (which only exists while a workspace is on screen).
 */
export function buildBoardsCommandCenterContributions(
  source: BoardsCommandCenterSource,
): CommandCenterContribution[] {
  const saved = source.views;
  const contributions: CommandCenterContribution[] = [
    {
      id: "views:split",
      group: GROUP,
      groupRank: 0,
      rank: 0,
      keywords: ["split", "workspaces", "view", "columns", "grid", "side"],
      visibility: "always",
      run: () => source.openSplitPicker(),
      presentation: {
        kind: "action",
        title: source.labels.split,
        sectionTitle: source.labels.section,
        icon: source.icons.split,
        shortcutKeys: source.shortcuts.split,
      },
    },
  ];
  saved.forEach((view, index) => {
    contributions.push({
      id: `views:open:${view.id}`,
      group: GROUP,
      groupRank: 0,
      rank: 1 + index,
      keywords: ["view", "split", "open", view.name],
      visibility: "query",
      run: () => source.openView(view.id),
      presentation: {
        kind: "action",
        title: source.labels.openView(view.name),
        sectionTitle: source.labels.section,
        icon: source.icons.view,
      },
    });
  });
  return contributions;
}

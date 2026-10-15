import { describe, expect, it, vi } from "vitest";
import {
  boardTabContextMenuTestId,
  buildBoardTabMenuEntries,
  resolveBoardTabsToClose,
} from "@/boards/board-tab-menu";
import type { WorkspaceTabMenuLabels } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

const AGENT_ID = "1fb50fd4-cda1-4d1f-a49b-8dd0aa21cab6";

const labels: WorkspaceTabMenuLabels = {
  copyResumeCommand: "Copy resume command",
  copyAgentId: "Copy agent id",
  copyTerminalId: "Copy terminal id",
  copyFilePath: "Copy file path",
  rename: "Rename",
  agentSettings: "Agent settings",
  closeAbove: "Close tabs above",
  closeBelow: "Close tabs below",
  closeLeft: "Close to the left",
  closeRight: "Close to the right",
  closeOthers: "Close other tabs",
  reloadAgent: "Reload agent",
  reloadAgentTooltip: "Reload",
  close: "Close",
};

function agentTab(): WorkspaceTabDescriptor {
  return {
    key: `agent_${AGENT_ID}`,
    tabId: `agent_${AGENT_ID}`,
    kind: "agent",
    target: { kind: "agent", agentId: AGENT_ID },
  };
}

function fileTab(): WorkspaceTabDescriptor {
  return {
    key: "file_/repo/a.ts",
    tabId: "file_/repo/a.ts",
    kind: "file",
    target: { kind: "file", path: "/repo/a.ts" },
  };
}

function handlers() {
  return {
    onCopyResumeCommand: vi.fn(),
    onCopyAgentId: vi.fn(),
    onCopyFilePath: vi.fn(),
    onReloadAgent: vi.fn(),
    onRenameTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseTabsBefore: vi.fn(),
    onCloseTabsAfter: vi.fn(),
    onCloseOtherTabs: vi.fn(),
  };
}

describe("buildBoardTabMenuEntries", () => {
  it("gives an agent view tab the same entries a workspace agent tab has", () => {
    const entries = buildBoardTabMenuEntries({
      tab: agentTab(),
      index: 1,
      tabCount: 3,
      labels,
      ...handlers(),
    });
    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy agent id",
      "Rename",
      "Close to the left",
      "Close to the right",
      "Close other tabs",
      "Reload agent",
      "Close",
    ]);
  });

  it("copies the FULL agent id, not the short one shown as a hint", () => {
    const h = handlers();
    const entries = buildBoardTabMenuEntries({
      tab: agentTab(),
      index: 0,
      tabCount: 1,
      labels,
      ...h,
    });
    const copy = entries.find((entry) => entry.kind === "item" && entry.key === "copy-agent-id");
    if (!copy || copy.kind !== "item") throw new Error("copy-agent-id entry missing");
    expect(copy.hint).toBe(AGENT_ID.slice(0, 7));
    copy.onSelect();
    expect(h.onCopyAgentId).toHaveBeenCalledWith(AGENT_ID);
  });

  it("routes rename, reload and close for the right tab", () => {
    const h = handlers();
    const tab = agentTab();
    const entries = buildBoardTabMenuEntries({ tab, index: 1, tabCount: 3, labels, ...h });
    const byKey = (key: string) => {
      const entry = entries.find((e) => e.kind === "item" && e.key === key);
      if (!entry || entry.kind !== "item") throw new Error(`${key} missing`);
      return entry;
    };
    byKey("rename").onSelect();
    byKey("reload-agent").onSelect();
    byKey("close").onSelect();
    byKey("close-before").onSelect();
    byKey("close-after").onSelect();
    byKey("close-others").onSelect();
    expect(h.onRenameTab).toHaveBeenCalledWith(tab);
    expect(h.onReloadAgent).toHaveBeenCalledWith(AGENT_ID);
    expect(h.onCloseTab).toHaveBeenCalledWith(tab.tabId);
    expect(h.onCloseTabsBefore).toHaveBeenCalledWith(tab.tabId);
    expect(h.onCloseTabsAfter).toHaveBeenCalledWith(tab.tabId);
    expect(h.onCloseOtherTabs).toHaveBeenCalledWith(tab.tabId);
  });

  it("disables close-left on the first tab, close-right on the last, close-others when alone", () => {
    const first = buildBoardTabMenuEntries({
      tab: agentTab(),
      index: 0,
      tabCount: 2,
      labels,
      ...handlers(),
    });
    expect(first.find((e) => e.kind === "item" && e.key === "close-before")).toMatchObject({
      disabled: true,
    });
    const only = buildBoardTabMenuEntries({
      tab: agentTab(),
      index: 0,
      tabCount: 1,
      labels,
      ...handlers(),
    });
    expect(only.find((e) => e.kind === "item" && e.key === "close-others")).toMatchObject({
      disabled: true,
    });
  });

  it("offers copy file path, and no agent entries, on a file tab", () => {
    const h = handlers();
    const entries = buildBoardTabMenuEntries({
      tab: fileTab(),
      index: 0,
      tabCount: 2,
      labels,
      ...h,
    });
    const keys = entries
      .filter((e) => e.kind === "item")
      .map((e) => (e.kind === "item" ? e.key : ""));
    expect(keys).toContain("copy-file-path");
    expect(keys).not.toContain("copy-agent-id");
    expect(keys).not.toContain("rename");
    expect(keys).not.toContain("reload-agent");
  });

  it("namespaces test ids under board-tab-context", () => {
    const tab = agentTab();
    const entries = buildBoardTabMenuEntries({ tab, index: 0, tabCount: 1, labels, ...handlers() });
    for (const entry of entries) {
      if (entry.kind === "item") {
        expect(entry.testID.startsWith(boardTabContextMenuTestId(tab.tabId))).toBe(true);
      }
    }
  });
});

describe("resolveBoardTabsToClose", () => {
  const ids = ["a", "b", "c", "d"];

  it("returns the tabs before, after, or all others", () => {
    expect(resolveBoardTabsToClose(ids, "c", "before")).toEqual(["a", "b"]);
    expect(resolveBoardTabsToClose(ids, "c", "after")).toEqual(["d"]);
    expect(resolveBoardTabsToClose(ids, "c", "others")).toEqual(["a", "b", "d"]);
  });

  it("returns nothing for a tab that is not in the pane", () => {
    expect(resolveBoardTabsToClose(ids, "z", "others")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { findAgentTabId } from "./open-session";

describe("findAgentTabId", () => {
  const tabs = [
    { tabId: "t-file", target: { kind: "file", path: "/a.md" } },
    { tabId: "t-term", target: { kind: "terminal", terminalId: "term-1" } },
    { tabId: "t-agent-1", target: { kind: "agent", agentId: "agent-1" } },
    { tabId: "t-agent-2", target: { kind: "agent", agentId: "agent-2" } },
  ] as Parameters<typeof findAgentTabId>[0];

  it("finds the tab that shows the agent", () => {
    expect(findAgentTabId(tabs, "agent-2")).toBe("t-agent-2");
    expect(findAgentTabId(tabs, "agent-1")).toBe("t-agent-1");
  });

  it("returns null when the workspace has no tab for the agent (the open will create one)", () => {
    expect(findAgentTabId(tabs, "agent-9")).toBeNull();
    expect(findAgentTabId([], "agent-1")).toBeNull();
  });
});

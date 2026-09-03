import { describe, expect, it } from "vitest";
import { classifyCodeQuickAction, getRevealParentPath } from "./quick-action";

describe("classifyCodeQuickAction", () => {
  it("treats a single absolute path as a path, spaces included", () => {
    expect(classifyCodeQuickAction("/Users/me/My Notes/01 – today.md\n")).toEqual({
      kind: "path",
      path: "/Users/me/My Notes/01 – today.md",
    });
    expect(classifyCodeQuickAction("~/DeepLearning/tools")).toEqual({
      kind: "path",
      path: "~/DeepLearning/tools",
    });
    expect(classifyCodeQuickAction("C:\\repo\\src")).toEqual({ kind: "path", path: "C:\\repo\\src" });
  });

  it("treats a single http(s) URL as a link", () => {
    expect(classifyCodeQuickAction("https://gemini.google.com/app?x=1")).toEqual({
      kind: "url",
      url: "https://gemini.google.com/app?x=1",
    });
  });

  it("ignores multi-line blocks, code and prose", () => {
    expect(classifyCodeQuickAction("/a\n/b")).toBeNull();
    expect(classifyCodeQuickAction("npm install foo")).toBeNull();
    expect(classifyCodeQuickAction("const x = 1;")).toBeNull();
    expect(classifyCodeQuickAction("https://a.com and more")).toBeNull();
    expect(classifyCodeQuickAction("   ")).toBeNull();
  });
});

describe("getRevealParentPath", () => {
  it("returns the containing folder", () => {
    expect(getRevealParentPath("/Users/me/notes/today.md")).toBe("/Users/me/notes");
    expect(getRevealParentPath("/Users/me/notes/")).toBe("/Users/me");
    expect(getRevealParentPath("/file.txt")).toBe("/");
    expect(getRevealParentPath("~/notes/today.md")).toBe("~/notes");
    expect(getRevealParentPath("~/today.md")).toBe("~");
    expect(getRevealParentPath("C:/x.txt")).toBe("C:/");
  });
});

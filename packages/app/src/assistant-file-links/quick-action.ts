import { isAbsolutePath } from "@/utils/path";

/**
 * What a single-line code block "is", for the hover buttons on it. A block that holds one
 * local path gets a "Reveal in Finder" button, one http(s) URL gets an "Open link" button.
 * Anything else — code, several lines, prose — gets neither and keeps only Copy.
 */
export type CodeQuickAction = { kind: "path"; path: string } | { kind: "url"; url: string };

const SINGLE_URL = /^https?:\/\/\S+$/i;

export function classifyCodeQuickAction(code: string): CodeQuickAction | null {
  const trimmed = code.trim();
  if (!trimmed || /[\r\n\t]/.test(trimmed)) {
    return null;
  }
  if (SINGLE_URL.test(trimmed)) {
    return { kind: "url", url: trimmed };
  }
  if (isAbsolutePath(trimmed) || trimmed === "~" || trimmed.startsWith("~/")) {
    return { kind: "path", path: trimmed };
  }
  return null;
}

/**
 * The folder Finder should open so it can select `path`. Home-relative input stays
 * home-relative; the desktop process expands the tilde.
 */
export function getRevealParentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return normalized;
  }
  if (lastSlash === 0) {
    return "/";
  }
  const parent = normalized.slice(0, lastSlash);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

import type { Tab } from "./useTabs";

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then fall back to the last segment of the
 * cwd. Keeping this pure makes the "custom name survives a cd" invariant
 * testable without rendering the bar.
 */
export function labelFor(t: Tab): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.customTitle) return t.customTitle;
  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/**
 * Full path (or url) behind a tab, shown as the tooltip. Renaming a terminal
 * tab hides the cwd from the label, so hovering is the way back to it.
 */
export function pathFor(t: Tab): string | null {
  switch (t.kind) {
    case "terminal":
      return t.cwd ?? null;
    case "editor":
    case "markdown":
    case "ai-diff":
    case "git-diff":
    case "git-commit-file":
      return t.path;
    case "preview":
      return t.url;
    default:
      return null;
  }
}

/**
 * Tooltip for a tab: the full path, plus the custom name when the user renamed
 * it away from the cwd-derived default.
 */
export function tooltipFor(t: Tab): string | undefined {
  const path = pathFor(t);
  const label = labelFor(t);
  if (!path) return undefined;
  return t.kind === "terminal" && t.customTitle && t.customTitle !== path
    ? `${label}\n${path}`
    : path;
}

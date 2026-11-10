import { describe, expect, it } from "vitest";
import { labelFor, pathFor, tooltipFor } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    scopeId: "scope-default-1",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/terax-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("pathFor", () => {
  it("returns the terminal cwd and the editor path", () => {
    expect(pathFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe(
      "C:\\Users\\me\\proj",
    );
  });

  it("returns null when a terminal has no cwd yet", () => {
    expect(pathFor(terminalTab({ title: "shell" }))).toBeNull();
  });
});

describe("tooltipFor", () => {
  it("shows the plain cwd for a tab that was not renamed", () => {
    expect(tooltipFor(terminalTab({ cwd: "/Users/me/proj" }))).toBe(
      "/Users/me/proj",
    );
  });

  it("shows the custom name and the real path once renamed", () => {
    expect(
      tooltipFor(terminalTab({ cwd: "/Users/me/proj", customTitle: "Server" })),
    ).toBe("Server\n/Users/me/proj");
  });

  it("has no tooltip without a path", () => {
    expect(tooltipFor(terminalTab({ title: "shell" }))).toBeUndefined();
  });
});

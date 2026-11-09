import { describe, expect, it } from "vitest";
import {
  orderFileEntries,
  stageRange,
  type SourceControlFileEntry,
} from "./useSourceControlPanel";

function entry(path: string): SourceControlFileEntry {
  return {
    key: path,
    path,
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    checkState: "unchecked",
    staged: false,
    unstaged: true,
    untracked: false,
    isSubmodule: false,
    insertions: 0,
    deletions: 0,
  };
}

describe("stageRange", () => {
  const entries = ["a.ts", "b.ts", "c.ts", "d.ts"].map(entry);

  it("selects the inclusive range in either direction", () => {
    expect(stageRange(entries, "b.ts", "d.ts").map((e) => e.path)).toEqual([
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
    expect(stageRange(entries, "d.ts", "b.ts").map((e) => e.path)).toEqual([
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  });

  it("returns the clicked row when the anchor is the same row", () => {
    expect(stageRange(entries, "c.ts", "c.ts").map((e) => e.path)).toEqual([
      "c.ts",
    ]);
  });

  it("falls back to nothing when the anchor is gone", () => {
    expect(stageRange(entries, "missing.ts", "b.ts")).toEqual([]);
  });
});

describe("orderFileEntries", () => {
  it("sorts by path so staging cannot move rows", () => {
    const entries = [entry("src/z.ts"), entry("src/a.ts"), entry("b.ts")];
    expect(orderFileEntries(entries).map((e) => e.path)).toEqual([
      "b.ts",
      "src/a.ts",
      "src/z.ts",
    ]);
  });
});

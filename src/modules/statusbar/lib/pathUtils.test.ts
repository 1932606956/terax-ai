import { describe, expect, it } from "vitest";
import { segmentsFromCwd } from "./pathUtils";

function shape(cwd: string, home: string | null) {
  return segmentsFromCwd(cwd, home).map((s) => ({
    label: s.label,
    fullPath: s.fullPath,
    isHome: s.isHome,
    isComputerRoot: s.isComputerRoot,
  }));
}

const COMPUTER_ROOT = {
  label: "",
  fullPath: "",
  isHome: false,
  isComputerRoot: true,
};

describe("segmentsFromCwd", () => {
  it("renders a path under home with a ~ root and accumulated paths", () => {
    expect(shape("/Users/me/projects/terax", "/Users/me")).toEqual([
      {
        label: "~",
        fullPath: "/Users/me",
        isHome: true,
        isComputerRoot: false,
      },
      {
        label: "projects",
        fullPath: "/Users/me/projects",
        isHome: false,
        isComputerRoot: false,
      },
      {
        label: "terax",
        fullPath: "/Users/me/projects/terax",
        isHome: false,
        isComputerRoot: false,
      },
    ]);
  });

  it("collapses the home directory itself to a single ~ segment", () => {
    expect(shape("/Users/me", "/Users/me")).toEqual([
      {
        label: "~",
        fullPath: "/Users/me",
        isHome: true,
        isComputerRoot: false,
      },
    ]);
  });

  it("does not treat a sibling that merely shares the home prefix as home", () => {
    const segments = shape("/Users/mefoo", "/Users/me");
    expect(segments[0]).toEqual({
      label: "/",
      fullPath: "/",
      isHome: false,
      isComputerRoot: false,
    });
    expect(segments.map((s) => s.label)).toEqual(["/", "Users", "mefoo"]);
  });

  it("builds unix absolute paths from the / root", () => {
    expect(shape("/usr/local/bin", null)).toEqual([
      { label: "/", fullPath: "/", isHome: false, isComputerRoot: false },
      { label: "usr", fullPath: "/usr", isHome: false, isComputerRoot: false },
      {
        label: "local",
        fullPath: "/usr/local",
        isHome: false,
        isComputerRoot: false,
      },
      {
        label: "bin",
        fullPath: "/usr/local/bin",
        isHome: false,
        isComputerRoot: false,
      },
    ]);
  });

  it("puts a virtual This PC root above the drive letter on Windows paths", () => {
    expect(shape("C:/Users/me/proj", null)).toEqual([
      COMPUTER_ROOT,
      { label: "C:", fullPath: "C:/", isHome: false, isComputerRoot: false },
      {
        label: "Users",
        fullPath: "C:/Users",
        isHome: false,
        isComputerRoot: false,
      },
      {
        label: "me",
        fullPath: "C:/Users/me",
        isHome: false,
        isComputerRoot: false,
      },
      {
        label: "proj",
        fullPath: "C:/Users/me/proj",
        isHome: false,
        isComputerRoot: false,
      },
    ]);
  });

  it("normalizes backslash separators", () => {
    expect(shape("C:\\Users\\me\\proj", null).map((s) => s.label)).toEqual([
      "",
      "C:",
      "Users",
      "me",
      "proj",
    ]);
  });

  it("returns computer root + drive for a bare drive, plain / for /", () => {
    expect(shape("C:/", null)).toEqual([
      COMPUTER_ROOT,
      { label: "C:", fullPath: "C:/", isHome: false, isComputerRoot: false },
    ]);
    expect(shape("/", null)).toEqual([
      { label: "/", fullPath: "/", isHome: false, isComputerRoot: false },
    ]);
  });

  it("marks only the first segment of a drive path as the computer root", () => {
    const segments = segmentsFromCwd("D:/work", null);
    expect(segments[0].isComputerRoot).toBe(true);
    expect(segments.slice(1).every((s) => !s.isComputerRoot)).toBe(true);
  });

  it("never adds the computer root on unix or home-rooted paths", () => {
    expect(segmentsFromCwd("/opt", null).some((s) => s.isComputerRoot)).toBe(
      false,
    );
    expect(
      segmentsFromCwd("/Users/me/x", "/Users/me").some((s) => s.isComputerRoot),
    ).toBe(false);
  });
});

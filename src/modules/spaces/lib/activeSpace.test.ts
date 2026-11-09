import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import {
  activeSpaceEnv,
  findActiveSpace,
  freshTabCwd,
  launchCwdForRestore,
} from "./activeSpace";
import type { SpaceMeta } from "./store";

function space(over: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "s1",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("findActiveSpace", () => {
  it("returns the space matching activeId", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, "b")?.id).toBe("b");
  });

  it("falls back to the first space when activeId is null or unknown", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, null)?.id).toBe("a");
    expect(findActiveSpace(spaces, "missing")?.id).toBe("a");
  });

  it("returns null when there are no spaces", () => {
    expect(findActiveSpace([], "a")).toBeNull();
  });
});

describe("activeSpaceEnv", () => {
  it("restores the active space's WSL env", () => {
    const spaces = [
      space({ id: "a", env: { kind: "local" } }),
      space({ id: "b", env: { kind: "wsl", distro: "Ubuntu" } }),
    ];
    expect(activeSpaceEnv(spaces, "b")).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
  });

  it("restores the env of the fallback space when activeId is missing", () => {
    const spaces = [space({ id: "a", env: { kind: "wsl", distro: "Debian" } })];
    expect(activeSpaceEnv(spaces, null)).toEqual({
      kind: "wsl",
      distro: "Debian",
    });
  });

  it("defaults to local when there are no spaces", () => {
    expect(activeSpaceEnv([], "a")).toEqual({ kind: "local" });
  });
});

describe("freshTabCwd", () => {
  const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  const local: WorkspaceEnv = { kind: "local" };

  it("prefers the restored home for a WSL env, ignoring the launch cwd", () => {
    expect(freshTabCwd(wsl, "/home/aj", "C:/Users/me", "C:/Users/me")).toBe(
      "/home/aj",
    );
  });

  it("prefers an explicit launch cwd over the restored home for local", () => {
    // Explorer "Open in Terax" / `terax <dir>`: the restored home is just
    // where the previous session happened to be.
    expect(freshTabCwd(local, "/home/aj", "D:/work", "C:/Users/me")).toBe(
      "D:/work",
    );
  });

  it("returns null for a WSL space when its home did not resolve", () => {
    expect(freshTabCwd(wsl, null, "C:/Users/me", "C:/Users/me")).toBeNull();
  });

  it("falls back to the local launch cwd then home for a local space", () => {
    expect(freshTabCwd(local, null, "C:/work", "C:/Users/me")).toBe("C:/work");
    expect(freshTabCwd(local, null, null, "C:/Users/me")).toBe("C:/Users/me");
    expect(freshTabCwd(local, null, null, null)).toBeNull();
  });
});

describe("launchCwdForRestore", () => {
  const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  const local: WorkspaceEnv = { kind: "local" };

  it("returns the CLI dir for a local space with restored tabs", () => {
    expect(launchCwdForRestore(local, "D:/work", true)).toBe("D:/work");
  });

  it("returns null on normal launches without a CLI dir", () => {
    expect(launchCwdForRestore(local, null, true)).toBeNull();
  });

  it("returns null for a WSL space, where Windows paths are meaningless", () => {
    expect(launchCwdForRestore(wsl, "C:/Users/me", true)).toBeNull();
  });

  it("returns null for an empty active space, covered by the fresh-tab fallback", () => {
    expect(launchCwdForRestore(local, "D:/work", false)).toBeNull();
  });
});

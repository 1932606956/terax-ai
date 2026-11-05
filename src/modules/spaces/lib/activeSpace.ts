import type { WorkspaceEnv } from "@/modules/workspace";
import type { SpaceMeta } from "./store";

export function findActiveSpace(
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta | null {
  if (activeId) {
    const found = spaces.find((s) => s.id === activeId);
    if (found) return found;
  }
  return spaces[0] ?? null;
}

export function activeSpaceEnv(
  spaces: SpaceMeta[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveSpace(spaces, activeId)?.env ?? { kind: "local" };
}

// A WSL space falls back to null, not the local cwd, so its first tab opens at
// the WSL home instead of a Windows path. For a local space an explicit launch
// dir (Explorer "Open in Terax", `terax <dir>`) wins over the restored home:
// it is a deliberate user action on this process, while the restored home is
// just where the previous session happened to be.
export function freshTabCwd(
  env: WorkspaceEnv,
  restoredHome: string | null,
  launchCwd: string | null,
  home: string | null,
): string | null {
  if (env.kind !== "local") return restoredHome;
  return launchCwd ?? restoredHome ?? home;
}

// CLI-passed dir (Explorer "Open in Terax", `terax <dir>`) that deserves its
// own tab on top of a restored session. Keys off the CLI-only value, never
// launchCwd: launchCwd falls back to home on normal launches, so it cannot
// tell "user aimed this process at a dir" from "no args". WSL spaces ignore
// it (a Windows path is meaningless there); an empty active space gets null
// because the freshTabCwd fallback below already lands on the launch cwd.
export function launchCwdForRestore(
  env: WorkspaceEnv,
  cliLaunchCwd: string | null,
  activeHasRestoredTabs: boolean,
): string | null {
  if (env.kind !== "local") return null;
  if (cliLaunchCwd === null || !activeHasRestoredTabs) return null;
  return cliLaunchCwd;
}

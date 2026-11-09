import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

// CLI-passed dir only (Explorer "Open in Terax", `terax <dir>`): stays
// undefined on normal launches, unlike `cached` which falls back to the
// process cwd. The spaces-restore branch keys its launch tab off this, so
// a fallback value must never leak in here.
let cachedCli: string | undefined;

export async function initLaunchDir(): Promise<void> {
  const cli =
    (await invoke<string | null>("get_launch_dir").catch(() => null)) ?? null;
  cachedCli = cli ? cli.replace(/\\/g, "/") : undefined;
  const dir =
    cli ?? (await invoke<string>("workspace_current_dir").catch(() => null));
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

/**
 * CLI-passed dir only; undefined on normal launches (no args).
 * Seeded by initLaunchDir before first paint, same as getLaunchDir.
 */
export function getCliLaunchDir(): string | undefined {
  return cachedCli;
}

/**
 * Drains the files passed via the OS "Open With" action (CLI args on
 * Linux/Windows, macOS open-files event). Drained once so HMR / re-mounts
 * can't replay them. Returns [] when the app wasn't launched with a file.
 */
export async function consumeLaunchFiles(): Promise<string[]> {
  const files = await invoke<string[]>("get_launch_files").catch(() => []);
  return files.map((f) => f.replace(/\\/g, "/"));
}

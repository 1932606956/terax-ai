import { t } from "@/i18n/zh";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort; ignore in environments without clipboard permission.
  }
}

export function relativePath(rootPath: string, path: string): string {
  if (path === rootPath) return ".";
  if (path.startsWith(`${rootPath}/`)) return path.slice(rootPath.length + 1);
  return path;
}

export async function revealInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (e) {
    console.error("revealItemInDir failed:", e);
  }
}

export async function openWithExternal(
  path: string,
  program: string | undefined,
): Promise<void> {
  try {
    await openPath(path, program);
  } catch (e) {
    console.error("openPath failed:", e);
    toast.error(t("ctx.openExternalFailed"));
  }
}

export async function openInWindowsTerminal(cwd: string): Promise<void> {
  try {
    await invoke("shell_open_windows_terminal", {
      cwd,
      workspace: currentWorkspaceEnv(),
    });
  } catch (e) {
    console.error("shell_open_windows_terminal failed:", e);
    toast.error(t("toast.windowsTerminalUnavailable"));
  }
}

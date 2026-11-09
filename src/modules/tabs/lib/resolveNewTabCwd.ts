import { open } from "@tauri-apps/plugin-dialog";

// Asks the user which folder a new tab should live in, starting from the
// inherited cwd. Returns the picked folder, or null when the dialog is
// cancelled so the caller creates nothing.
export async function resolveNewTabCwd(
  preferred?: string | null,
): Promise<string | null> {
  const picked = await open({
    directory: true,
    defaultPath: preferred ?? undefined,
  });
  return picked;
}

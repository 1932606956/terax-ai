export type SuppressionMode = "off" | "altScreen" | "always";

export function shouldSuppressShortcut(
  mode: SuppressionMode,
  inTerminal: boolean,
  altScreen: boolean | null,
): boolean {
  if (mode === "off") return false;
  if (!inTerminal) return false;
  if (mode === "always") return true;
  return altScreen === true;
}

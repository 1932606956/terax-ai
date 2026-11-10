/** Stable per-tab identity for AI binding; survives restore, move, cwd. */
export function createTabScopeId(): string {
  return crypto.randomUUID();
}

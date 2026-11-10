import type { Tab } from "@/modules/tabs";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";

/**
 * The terminal whose cwd/buffer the AI assistant of `scopeId` reads. The
 * active tab when it is a terminal of that scope; otherwise the most recent
 * terminal tab of the same scope; never a terminal of another scope, so a
 * chat keeps its project context after the user switches tabs.
 */
export function scopeContextTerminal(
  tabs: Tab[],
  activeId: number,
  scopeId: string | null,
): TerminalTab | null {
  const active = tabs.find((t) => t.id === activeId);
  if (
    active?.kind === "terminal" &&
    (scopeId === null || active.scopeId === scopeId)
  ) {
    return active;
  }
  const pool = scopeId === null ? tabs : tabs.filter((t) => t.scopeId === scopeId);
  for (let i = pool.length - 1; i >= 0; i--) {
    const t = pool[i];
    if (t.kind === "terminal") return t;
  }
  return null;
}

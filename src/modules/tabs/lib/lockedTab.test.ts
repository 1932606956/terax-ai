import { describe, expect, it } from "vitest";
import {
  applyCloseTabsPlan,
  type Tab,
  type TerminalTab,
  planCloseOtherTabs,
  planCloseTabsToRight,
  planSingleTabClose,
} from "./useTabs";

function terminal(
  id: number,
  leafId: number,
  over: Partial<TerminalTab> = {},
): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "a",
    scopeId: `scope-a-${id}`,
    title: "shell",
    paneTree: { kind: "leaf", id: leafId, cwd: "/a" },
    activeLeafId: leafId,
    cwd: "/a",
    ...over,
  };
}

describe("locked tab close protection", () => {
  it("refuses to plan a single close of a locked tab", () => {
    const tabs = [terminal(1, 10, { locked: true }), terminal(2, 20)];
    expect(planSingleTabClose(tabs, 1, 1)).toBeNull();
  });

  it("still closes an unlocked sibling of a locked tab", () => {
    const tabs = [terminal(1, 10, { locked: true }), terminal(2, 20)];
    const result = planSingleTabClose(tabs, 2, 2);
    expect(result?.tabs.map((t) => t.id)).toEqual([1]);
  });

  it("keeps locked tabs in close-right and close-other plans", () => {
    const tabs = [
      terminal(1, 10),
      terminal(2, 20, { locked: true }),
      terminal(3, 30),
    ];
    // The plans name every candidate; applyCloseTabsPlan filters the locked.
    const right = planCloseTabsToRight(tabs, 1, 1);
    const appliedRight = applyCloseTabsPlan(tabs, 1, right);
    expect(appliedRight?.closeIds).toEqual([3]);

    const others = planCloseOtherTabs(tabs, 3, 3);
    const appliedOthers = applyCloseTabsPlan(tabs, 3, others);
    expect(appliedOthers?.closeIds).toEqual([1]);
  });

  it("applies nothing when every candidate except the anchor is locked", () => {
    const tabs = [
      terminal(1, 10, { locked: true }),
      terminal(2, 20),
      terminal(3, 30, { locked: true }),
    ];
    expect(applyCloseTabsPlan(tabs, 2, planCloseOtherTabs(tabs, 2, 2)))
      .toBeNull();
  });
});

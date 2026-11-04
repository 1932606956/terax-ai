import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTab } from "./useTabs";
import { useTabs } from "./useTabs";

const scheduler = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  pending: [] as (() => void)[],
  dispose: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/terminalSessionApi", () => ({
  disposeSession: scheduler.dispose,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = scheduler.cursor++;
    if (!(index in scheduler.slots))
      scheduler.slots[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      scheduler.slots[index],
      (action: T | ((value: T) => T)) => {
        scheduler.pending.push(() => {
          scheduler.slots[index] =
            typeof action === "function"
              ? (action as (value: T) => T)(scheduler.slots[index] as T)
              : action;
        });
      },
    ];
  },
  useRef: <T>(initial: T) => {
    const index = scheduler.cursor++;
    if (!(index in scheduler.slots))
      scheduler.slots[index] = { current: initial };
    return scheduler.slots[index];
  },
  useCallback: <T>(callback: T) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
}));

function render(): ReturnType<typeof useTabs> {
  for (const commit of scheduler.pending.splice(0)) commit();
  scheduler.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: hooks use the deferred scheduler above, not React's dispatcher.
  return useTabs();
}

beforeEach(() => {
  scheduler.cursor = 0;
  scheduler.slots = [];
  scheduler.pending = [];
  scheduler.dispose.mockClear();
});

describe("locked tab working directory", () => {
  it("ignores leaf cwd updates while locked and resumes after unlock", () => {
    const tabs = render();
    // newTab(): tabId 3, leafId 4.
    const created = tabs.newTab();
    expect(created).toBe(3);

    tabs.updateTab(created, { locked: true });
    tabs.setLeafCwd(4, "/elsewhere");
    let tab = render().tabs.find(
      (t): t is TerminalTab => t.id === created,
    ) as TerminalTab;
    expect(tab.cwd).toBeUndefined();
    expect(tab.paneTree).toEqual({ kind: "leaf", id: 4 });

    tabs.updateTab(created, { locked: false });
    tabs.setLeafCwd(4, "/elsewhere");
    tab = render().tabs.find(
      (t): t is TerminalTab => t.id === created,
    ) as TerminalTab;
    expect(tab.cwd).toBe("/elsewhere");
    expect(tab.paneTree).toEqual({ kind: "leaf", id: 4, cwd: "/elsewhere" });
  });

  it("ignores direct cwd patches while locked", () => {
    const tabs = render();
    const created = tabs.newTab();
    tabs.updateTab(created, { locked: true, cwd: "/pinned" });
    tabs.updateTab(created, { cwd: "/moved" });
    const tab = render().tabs.find(
      (t): t is TerminalTab => t.id === created,
    ) as TerminalTab;
    // The patch that locked the tab also set its cwd; later patches are dropped.
    expect(tab.cwd).toBe("/pinned");
  });

  it("closeTab does not dispose a locked tab", () => {
    const tabs = render();
    const created = tabs.newTab();
    tabs.updateTab(created, { locked: true });
    tabs.closeTab(created);
    const next = render();
    expect(next.tabs.some((t) => t.id === created)).toBe(true);
    expect(scheduler.dispose).not.toHaveBeenCalled();
  });
});

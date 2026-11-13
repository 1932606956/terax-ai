import { beforeEach, describe, expect, it } from "vitest";
import { peekArea, usePeekStore } from "./peekStore";

const TAB_A = "scope-a";
const TAB_B = "scope-b";

function reset() {
  usePeekStore.setState({ areas: {} });
}

/** Tabs of one workspace tab's peek card, in strip order. */
function pathsOf(scopeId: string) {
  return peekArea(usePeekStore.getState().areas, scopeId).tabs.map(
    (t) => t.path,
  );
}

describe("peekStore", () => {
  beforeEach(reset);

  it("opens a new tab and activates it", () => {
    const { open } = usePeekStore.getState();
    open("a.ts", TAB_A);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs).toHaveLength(1);
    expect(area.tabs[0].path).toBe("a.ts");
    expect(area.tabs[0].dirty).toBe(false);
    expect(area.activeId).toBe(area.tabs[0].id);
  });

  it("is idempotent for the same path (activates, no duplicate)", () => {
    const { open } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("a.ts", TAB_A);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(area.activeId).toBe(area.tabs[0].id);
  });

  it("keeps every workspace tab's peek card separate", () => {
    const { open } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_B);
    open("a.ts", TAB_B);
    expect(pathsOf(TAB_A)).toEqual(["a.ts"]);
    expect(pathsOf(TAB_B)).toEqual(["b.ts", "a.ts"]);
    // The same path opened twice is two independent cards, not one shared tab.
    const a = peekArea(usePeekStore.getState().areas, TAB_A);
    const b = peekArea(usePeekStore.getState().areas, TAB_B);
    expect(a.tabs[0].id).not.toBe(b.tabs[0].id);
    expect(b.activeId).toBe(b.tabs[1].id);
  });

  it("activating a tab only moves its own card", () => {
    const { open, setActive } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("c.ts", TAB_B);
    const [a] = peekArea(usePeekStore.getState().areas, TAB_A).tabs;
    const before = peekArea(usePeekStore.getState().areas, TAB_B);
    setActive(TAB_A, a.id);
    expect(peekArea(usePeekStore.getState().areas, TAB_A).activeId).toBe(a.id);
    expect(peekArea(usePeekStore.getState().areas, TAB_B)).toBe(before);
  });

  it("setActive ignores unknown ids and other cards' ids", () => {
    const { open, setActive } = usePeekStore.getState();
    open("a.ts", TAB_A);
    const other = peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].id;
    open("b.ts", TAB_B);
    setActive(TAB_B, other);
    const area = peekArea(usePeekStore.getState().areas, TAB_B);
    expect(area.activeId).toBe(area.tabs[0].id);
    setActive(TAB_B, "nope");
    expect(peekArea(usePeekStore.getState().areas, TAB_B).activeId).toBe(
      area.tabs[0].id,
    );
  });

  it("close removes a clean tab and picks the right neighbor", () => {
    const { open, close } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("c.ts", TAB_A);
    const [a, b] = peekArea(usePeekStore.getState().areas, TAB_A).tabs;
    expect(close(b.id)).toBe(true);
    expect(pathsOf(TAB_A)).toEqual(["a.ts", "c.ts"]);
    const afterB = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(afterB.activeId).toBe(afterB.tabs[1].id);
    expect(close(a.id)).toBe(true);
    const afterA = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(afterA.activeId).toBe(afterA.tabs[0].id);
    expect(close(afterA.tabs[0].id)).toBe(true);
    // The last close drops the card entirely.
    expect(peekArea(usePeekStore.getState().areas, TAB_A).tabs).toHaveLength(0);
    expect(usePeekStore.getState().areas[TAB_A]).toBeUndefined();
  });

  it("close refuses a dirty tab; forceClose removes it", () => {
    const { open, setDirty, close, forceClose } = usePeekStore.getState();
    open("a.ts", TAB_A);
    const { id } = peekArea(usePeekStore.getState().areas, TAB_A).tabs[0];
    setDirty(id, true);
    expect(peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].dirty).toBe(
      true,
    );
    expect(close(id)).toBe(false);
    expect(pathsOf(TAB_A)).toEqual(["a.ts"]);
    forceClose(id);
    expect(peekArea(usePeekStore.getState().areas, TAB_A).tabs).toHaveLength(0);
    expect(usePeekStore.getState().areas[TAB_A]).toBeUndefined();
  });

  it("setDirty toggles without duplicating state updates", () => {
    const { open, setDirty } = usePeekStore.getState();
    open("a.ts", TAB_A);
    const { id, dirty } = peekArea(usePeekStore.getState().areas, TAB_A)
      .tabs[0];
    const before = usePeekStore.getState().areas;
    setDirty(id, dirty);
    expect(usePeekStore.getState().areas).toBe(before);
    setDirty(id, !dirty);
    expect(peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].dirty).toBe(
      !dirty,
    );
  });

  it("closeAll blocks on dirty tabs of that card only", () => {
    const { open, setDirty, closeAll, clear } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    const dirtyId = peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].id;
    setDirty(dirtyId, true);
    expect(closeAll(TAB_A)).toBe(false);
    expect(pathsOf(TAB_A)).toEqual(["a.ts", "b.ts"]);
    // Another card's dirt never blocks this one.
    open("c.ts", TAB_B);
    expect(closeAll(TAB_B)).toBe(true);
    expect(pathsOf(TAB_B)).toEqual([]);
    clear(TAB_A);
    expect(peekArea(usePeekStore.getState().areas, TAB_A).tabs).toHaveLength(0);
  });

  it("closeOthers keeps the target and closes clean others", () => {
    const { open, closeOthers } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("c.ts", TAB_A);
    const kept = peekArea(usePeekStore.getState().areas, TAB_A).tabs[1].id;
    expect(closeOthers(TAB_A, kept)).toBe(true);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs).toHaveLength(1);
    expect(area.tabs[0].id).toBe(kept);
    expect(area.activeId).toBe(kept);
  });

  it("closeOthers never touches another card's tabs", () => {
    const { open, closeOthers } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("c.ts", TAB_B);
    const kept = peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].id;
    expect(closeOthers(TAB_A, kept)).toBe(true);
    expect(pathsOf(TAB_A)).toEqual(["a.ts"]);
    expect(pathsOf(TAB_B)).toEqual(["c.ts"]);
  });

  it("closeOthers blocks when another tab of the same card is dirty", () => {
    const { open, setDirty, closeOthers } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    open("c.ts", TAB_A);
    const before = peekArea(usePeekStore.getState().areas, TAB_A).tabs;
    setDirty(before[1].id, true);
    expect(closeOthers(TAB_A, before[0].id)).toBe(false);
    expect(pathsOf(TAB_A)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("closeOthers ignores dirt on the kept tab alone", () => {
    const { open, setDirty, closeOthers } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_A);
    const kept = peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].id;
    setDirty(kept, true);
    expect(closeOthers(TAB_A, kept)).toBe(true);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs).toHaveLength(1);
    expect(area.tabs[0].id).toBe(kept);
  });

  it("scopeDirty reports a card's unsaved files", () => {
    const { open, setDirty, scopeDirty } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_B);
    expect(scopeDirty(TAB_A)).toBe(false);
    setDirty(peekArea(usePeekStore.getState().areas, TAB_A).tabs[0].id, true);
    expect(scopeDirty(TAB_A)).toBe(true);
    expect(scopeDirty(TAB_B)).toBe(false);
    expect(scopeDirty("unknown")).toBe(false);
  });

  it("dropScope removes one card and leaves the others", () => {
    const { open, dropScope } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("b.ts", TAB_B);
    dropScope(TAB_A);
    expect(pathsOf(TAB_A)).toEqual([]);
    expect(pathsOf(TAB_B)).toEqual(["b.ts"]);
    dropScope("unknown");
    expect(pathsOf(TAB_B)).toEqual(["b.ts"]);
  });

  it("opens a working diff tab carrying its source", () => {
    const diff = {
      kind: "working" as const,
      repoRoot: "D:/repo",
      path: "src/a.ts",
      mode: "-" as const,
      originalPath: null,
    };
    usePeekStore.getState().openDiff(diff, TAB_A);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs).toHaveLength(1);
    expect(area.tabs[0].path).toBe("src/a.ts");
    expect(area.tabs[0].diff).toEqual(diff);
    expect(area.activeId).toBe(area.tabs[0].id);
  });

  it("keeps a file tab distinct from a diff tab of the same path", () => {
    const { open } = usePeekStore.getState();
    open("src/a.ts", TAB_A);
    usePeekStore.getState().openDiff(
      {
        kind: "working",
        repoRoot: "D:/repo",
        path: "src/a.ts",
        mode: "+",
        originalPath: null,
      },
      TAB_A,
    );
    expect(pathsOf(TAB_A)).toEqual(["src/a.ts", "src/a.ts"]);
  });

  it("re-activates a diff tab for the same revision instead of duplicating", () => {
    const diff = {
      kind: "commit" as const,
      repoRoot: "D:/repo",
      sha: "abc123",
      path: "src/a.ts",
      originalPath: null,
    };
    usePeekStore.getState().openDiff(diff, TAB_A);
    usePeekStore
      .getState()
      .openDiff(
        { ...diff, kind: "working" as const, mode: "+" as const } as never,
        TAB_A,
      );
    usePeekStore.getState().openDiff(diff, TAB_A);
    const area = peekArea(usePeekStore.getState().areas, TAB_A);
    expect(area.tabs).toHaveLength(2);
    expect(area.activeId).toBe(area.tabs[0].id);
  });

  it("renames and removes paths across every card", () => {
    const { open, renamePath, removePath } = usePeekStore.getState();
    open("a.ts", TAB_A);
    open("a.ts", TAB_B);
    open("b.ts", TAB_A);
    renamePath("a.ts", "c.ts");
    expect(pathsOf(TAB_A)).toEqual(["c.ts", "b.ts"]);
    expect(pathsOf(TAB_B)).toEqual(["c.ts"]);
    removePath("c.ts");
    expect(pathsOf(TAB_A)).toEqual(["b.ts"]);
    expect(pathsOf(TAB_B)).toEqual([]);
  });
});

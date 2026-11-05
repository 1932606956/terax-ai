import { beforeEach, describe, expect, it } from "vitest";
import { usePeekStore } from "./peekStore";

function reset() {
  usePeekStore.setState({ tabs: [], activeId: null, activeSpaceId: null });
}

describe("peekStore", () => {
  beforeEach(reset);

  it("opens a new tab and activates it", () => {
    const { open } = usePeekStore.getState();
    open("a.ts", "space-1");
    const s = usePeekStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].path).toBe("a.ts");
    expect(s.tabs[0].dirty).toBe(false);
    expect(s.activeId).toBe(s.tabs[0].id);
    expect(s.activeSpaceId).toBe("space-1");
  });

  it("is idempotent for the same path (activates, no duplicate)", () => {
    const { open } = usePeekStore.getState();
    open("a.ts", "s");
    open("b.ts", "s");
    open("a.ts", "s");
    const s = usePeekStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("close removes a clean tab and picks the right neighbor", () => {
    const { open, close } = usePeekStore.getState();
    open("a.ts", "s");
    open("b.ts", "s");
    open("c.ts", "s");
    const [a, b] = usePeekStore.getState().tabs;
    expect(close(b.id)).toBe(true);
    let s = usePeekStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["a.ts", "c.ts"]);
    expect(s.activeId).toBe(s.tabs[1].id);
    expect(close(a.id)).toBe(true);
    s = usePeekStore.getState();
    expect(s.activeId).toBe(s.tabs[0].id);
    expect(close(s.tabs[0].id)).toBe(true);
    s = usePeekStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeId).toBeNull();
  });

  it("close refuses a dirty tab; forceClose removes it", () => {
    const { open, setDirty, close, forceClose } = usePeekStore.getState();
    open("a.ts", "s");
    const { id } = usePeekStore.getState().tabs[0];
    setDirty(id, true);
    expect(usePeekStore.getState().tabs[0].dirty).toBe(true);
    expect(close(id)).toBe(false);
    expect(usePeekStore.getState().tabs).toHaveLength(1);
    forceClose(id);
    expect(usePeekStore.getState().tabs).toHaveLength(0);
    expect(usePeekStore.getState().activeId).toBeNull();
  });

  it("setDirty toggles without duplicating state updates", () => {
    const { open, setDirty } = usePeekStore.getState();
    open("a.ts", "s");
    const { id, dirty } = usePeekStore.getState().tabs[0];
    const before = usePeekStore.getState().tabs;
    setDirty(id, dirty);
    expect(usePeekStore.getState().tabs).toBe(before);
    setDirty(id, !dirty);
    expect(usePeekStore.getState().tabs[0].dirty).toBe(!dirty);
  });

  it("closeAll blocks on dirty tabs, clear removes everything", () => {
    const { open, setDirty, closeAll, clear } = usePeekStore.getState();
    open("a.ts", "s");
    open("b.ts", "s");
    const dirtyId = usePeekStore.getState().tabs[0].id;
    setDirty(dirtyId, true);
    expect(closeAll()).toBe(false);
    expect(usePeekStore.getState().tabs).toHaveLength(2);
    clear();
    expect(usePeekStore.getState().tabs).toHaveLength(0);
    expect(usePeekStore.getState().activeId).toBeNull();
  });

  it("setActive ignores unknown ids", () => {
    const { open, setActive } = usePeekStore.getState();
    open("a.ts", "s");
    setActive("nope");
    const s = usePeekStore.getState();
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("opens a working diff tab carrying its source", () => {
    const diff = {
      kind: "working" as const,
      repoRoot: "D:/repo",
      path: "src/a.ts",
      mode: "-" as const,
      originalPath: null,
    };
    usePeekStore.getState().openDiff(diff, "s");
    const s = usePeekStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].path).toBe("src/a.ts");
    expect(s.tabs[0].diff).toEqual(diff);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("keeps a file tab distinct from a diff tab of the same path", () => {
    const { open } = usePeekStore.getState();
    open("src/a.ts", "s");
    usePeekStore.getState().openDiff(
      {
        kind: "working",
        repoRoot: "D:/repo",
        path: "src/a.ts",
        mode: "+",
        originalPath: null,
      },
      "s",
    );
    expect(usePeekStore.getState().tabs).toHaveLength(2);
  });

  it("re-activates a diff tab for the same revision instead of duplicating", () => {
    const diff = {
      kind: "commit" as const,
      repoRoot: "D:/repo",
      sha: "abc123",
      path: "src/a.ts",
      originalPath: null,
    };
    usePeekStore.getState().openDiff(diff, "s");
    usePeekStore.getState().openDiff(
      { ...diff, kind: "working" as const, mode: "+" as const } as never,
      "s",
    );
    usePeekStore.getState().openDiff(diff, "s");
    const s = usePeekStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[0].id);
  });
});

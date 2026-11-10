import { describe, expect, it } from "vitest";
import {
  hydrateTabs,
  serializeTabs,
  type SerializedTab,
} from "@/modules/spaces/lib/serialize";
import type { Tab } from "@/modules/tabs/lib/useTabs";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function term(over: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "s1",
    scopeId: "scope-a",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/a" },
    activeLeafId: 2,
    locked: true,
    ...over,
  } as Tab;
}

describe("tab scopeId identity", () => {
  it("round-trips the scopeId through serialize and hydrate", () => {
    const tabs = [term({ scopeId: "scope-keep" })];
    const saved = serializeTabs(tabs);
    const restored = hydrateTabs(saved, "s1", counter());
    expect(restored).toHaveLength(1);
    expect(restored[0].scopeId).toBe("scope-keep");
  });

  it("generates a fresh identity for legacy tabs missing scopeId", () => {
    const legacy = serializeTabs([term({})]);
    const stripped = legacy.map((s) => {
      const { scopeId: _drop, ...rest } = s as SerializedTab & {
        scopeId?: string;
      };
      return rest;
    }) as SerializedTab[];
    const a = hydrateTabs(stripped, "s1", counter(100));
    const b = hydrateTabs(stripped, "s1", counter(200));
    expect(a[0].scopeId).toBeTruthy();
    expect(b[0].scopeId).toBeTruthy();
    expect(a[0].scopeId).not.toBe(b[0].scopeId);
  });

  it("keeps scopeIds stable when restore order is shuffled", () => {
    const tabs = [
      term({
        id: 1,
        scopeId: "scope-first",
        locked: true,
        paneTree: { kind: "leaf", id: 2, cwd: "/proj-a" },
        activeLeafId: 2,
      }),
      term({
        id: 3,
        scopeId: "scope-second",
        locked: true,
        paneTree: { kind: "leaf", id: 4, cwd: "/proj-b" },
        activeLeafId: 4,
      }),
    ];
    const saved = serializeTabs(tabs);
    const restored = hydrateTabs([...saved].reverse(), "s1", counter());
  expect(restored).toHaveLength(2);
  const [first, second] = restored;
  if (first.kind !== "terminal" || second.kind !== "terminal") {
    throw new Error("restored tabs are not terminal tabs");
  }
  expect(first.cwd).toBe("/proj-b");
  expect(first.scopeId).toBe("scope-second");
  expect(second.cwd).toBe("/proj-a");
  expect(second.scopeId).toBe("scope-first");
  });

  it("keeps the scopeId when a tab moves spaces", () => {
    const tabs = [term({ id: 1, scopeId: "scope-move", locked: true })];
    const saved = serializeTabs(tabs);
    const restored = hydrateTabs(saved, "s2", counter());
    expect(restored).toHaveLength(1);
    expect(restored[0].spaceId).toBe("s2");
    expect(restored[0].scopeId).toBe("scope-move");
  });

  it("an AI diff tab reuses the approving run's scope, not a fresh one", async () => {
    // Real behavior chain: the diff tab's scopeId comes from
    // useChatStore.activeScopeId at open time, so activating the diff runs
    // setActiveScope on the scope the session already belongs to - a
    // no-op that keeps session/panel instead of parking them on an empty
    // scope. Verified against the store, not a constructed tab object.
    const { useChatStore } = await import("@/modules/ai/store/chatStore");
    const runScope = "scope-run";
    useChatStore.setState({
      sessionsHydrated: true,
      sessions: [
        { id: "s1", title: "t", createdAt: 1, updatedAt: 1, scopeId: runScope },
      ],
      scopeSessions: { [runScope]: "s1" },
      activeScopeId: runScope,
      activeSessionId: "s1",
      panelOpen: true,
      mini: { open: true },
      scopeUI: {},
    });
    useChatStore.getState().setActiveScope(runScope);
    const s = useChatStore.getState();
    expect(s.activeSessionId).toBe("s1");
    expect(s.panelOpen).toBe(true);
    expect(s.mini.open).toBe(true);
  });
});

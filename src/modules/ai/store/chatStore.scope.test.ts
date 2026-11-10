import type { Chat, UIMessage } from "@ai-sdk/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  chats,
  seedMessages,
  useChatStore,
  type AgentMeta,
} from "@/modules/ai/store/chatStore";

const sessions = vi.hoisted(() => ({
  saveMessages: vi.fn(async () => {}),
  loadAll: vi.fn(async () => ({ sessions: [], activeId: null })),
  loadMessages: vi.fn<(id: string) => Promise<unknown[] | null>>(
    async () => null,
  ),
  saveSessionsList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
  deleteSessionData: vi.fn(async () => {}),
  deriveTitle: vi.fn(() => "New chat"),
  newSessionId: vi.fn(),
}));
vi.mock("@/modules/ai/lib/sessions", () => sessions);
vi.mock("@/modules/ai/lib/todos", () => ({
  loadTodos: vi.fn(async () => []),
  saveTodos: vi.fn(async () => {}),
  deleteTodos: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const idle = (): AgentMeta => ({
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
});

const session = (id: string, scopeId: string, updatedAt = 1) => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  scopeId,
});

let seq = 0;
beforeEach(() => {
  seq = 0;
  sessions.newSessionId.mockReset();
  sessions.newSessionId.mockImplementation(() => `s-fresh-${++seq}`);
  sessions.saveSessionsList.mockClear();
  sessions.saveActiveId.mockClear();
  sessions.deleteSessionData.mockClear();
  sessions.loadMessages.mockReset();
  sessions.loadMessages.mockResolvedValue([]);
  chats.clear();
  seedMessages.clear();
  useChatStore.setState({
    sessionsHydrated: true,
    sessions: [],
    activeSessionId: null,
    activeScopeId: null,
    scopeSessions: {},
    scopeUI: {},
    scopeDrafts: {},
    agentMeta: idle(),
    panelOpen: false,
    mini: { open: false },
    pendingPrefill: null,
    pendingSelections: [],
    approvalResponder: null,
    focusSignal: 0,
  });
});

it("switching scopes swaps the active session and restores each scope's own session on return", async () => {
  useChatStore.setState({
    sessions: [
      session("a2", "scopeA", 2),
      session("a1", "scopeA", 1),
      session("b1", "scopeB", 3),
    ],
  });
  const { setActiveScope } = useChatStore.getState();

  setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("a2"),
  );
  setActiveScope("scopeB");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("b1"),
  );
  setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("a2"),
  );
});

it("entering a scope with no session creates a fresh one bound to that scope", () => {
  useChatStore.setState({ sessions: [session("b1", "scopeB")] });
  useChatStore.getState().setActiveScope("scopeA");

  const s = useChatStore.getState();
  expect(s.activeSessionId).toBe("s-fresh-1");
  expect(s.sessions[0].scopeId).toBe("scopeA");
  expect(s.scopeSessions.scopeA).toBe("s-fresh-1");
  expect(sessions.saveSessionsList).toHaveBeenCalled();
});

it("switching away stops a running chat and clears pending UI state; panel state is per scope", () => {
  useChatStore.setState({
    sessions: [session("a1", "scopeA"), session("b1", "scopeB")],
    activeScopeId: "scopeA",
    activeSessionId: "a1",
    panelOpen: true,
    mini: { open: true },
    pendingPrefill: "hello",
    pendingSelections: [
      { id: "sel", text: "some text", source: "terminal" as const },
    ],
    approvalResponder: () => {},
    agentMeta: { ...idle(), status: "streaming" },
    scopeUI: { scopeB: { panelOpen: false, miniOpen: false } },
  });
  const stop = vi.fn(async () => {});
  chats.set("a1", { stop } as unknown as Chat<UIMessage>);

  useChatStore.getState().setActiveScope("scopeB");

  const s = useChatStore.getState();
  expect(stop).toHaveBeenCalledOnce();
  expect(s.panelOpen).toBe(false);
  expect(s.mini.open).toBe(false);
  expect(s.pendingPrefill).toBeNull();
  expect(s.pendingSelections).toEqual([]);
  expect(s.approvalResponder).toBeNull();
  expect(s.agentMeta.status).toBe("idle");

  useChatStore.getState().setActiveScope("scopeA");
  const back = useChatStore.getState();
  expect(back.panelOpen).toBe(true);
  expect(back.mini.open).toBe(true);
  expect(back.activeSessionId).toBe("a1");
});

it("switching away does not stop a chat that is only awaiting approval", () => {
  useChatStore.setState({
    sessions: [session("a1", "scopeA"), session("b1", "scopeB")],
    activeScopeId: "scopeA",
    activeSessionId: "a1",
    agentMeta: { ...idle(), status: "awaiting-approval" },
  });
  const stop = vi.fn(async () => {});
  chats.set("a1", { stop } as unknown as Chat<UIMessage>);

  useChatStore.getState().setActiveScope("scopeB");
  expect(stop).not.toHaveBeenCalled();
});

it("newSession binds to the active scope and remembers it for that scope", () => {
  useChatStore.setState({ sessions: [session("a1", "scopeA")] });
  useChatStore.getState().setActiveScope("scopeA");

  const id = useChatStore.getState().newSession();
  const s = useChatStore.getState();
  expect(s.activeSessionId).toBe(id);
  expect(s.sessions[0].scopeId).toBe("scopeA");
  expect(s.scopeSessions.scopeA).toBe(id);
});

it("switchSession refuses a session that belongs to another scope", async () => {
  useChatStore.setState({
    sessions: [session("a1", "scopeA"), session("b1", "scopeB")],
  });
  useChatStore.getState().setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("a1"),
  );

  useChatStore.getState().switchSession("b1");
  expect(useChatStore.getState().activeSessionId).toBe("a1");

  useChatStore.getState().switchSession("a1");
  expect(useChatStore.getState().activeSessionId).toBe("a1");
});

it("deleting the last session of a scope creates a fresh one in that scope, never in another", async () => {
  useChatStore.setState({
    sessions: [session("b1", "scopeB", 1), session("a1", "scopeA", 2)],
  });
  useChatStore.getState().setActiveScope("scopeB");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("b1"),
  );

  useChatStore.getState().deleteSession("b1");

  const s = useChatStore.getState();
  // b1 was the only scopeB session; the replacement fresh session stays in
  // scopeB and a1 (scopeA) is untouched.
  expect(s.sessions.map((x) => x.id).join(",")).toBe("s-fresh-1,a1");
  expect(s.sessions[0].scopeId).toBe("scopeB");
  expect(s.activeSessionId).toBe("s-fresh-1");
  expect(s.activeScopeId).toBe("scopeB");
});

it("legacy sessions without a scope are adopted by the first activated scope, keeping their ids", async () => {
  useChatStore.setState({
    sessions: [session("old1", "", 1), session("a1", "scopeA", 2)],
  });
  useChatStore.getState().setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("a1"),
  );

  const s = useChatStore.getState();
  expect(s.sessions.find((x) => x.id === "old1")?.scopeId).toBe("scopeA");
  expect(sessions.saveSessionsList).toHaveBeenCalled();
});

it("composer drafts are isolated per scope", () => {
  const { setActiveScope, patchDraft } = useChatStore.getState();
  setActiveScope("scopeA");
  patchDraft("scopeA", { value: "draft A" });
  setActiveScope("scopeB");
  patchDraft("scopeB", { value: "draft B" });

  const s = useChatStore.getState();
  expect(s.scopeDrafts.scopeA?.value).toBe("draft A");
  expect(s.scopeDrafts.scopeB?.value).toBe("draft B");
});

it("a scope whose session needs a disk load activates only after the messages arrive", async () => {
  useChatStore.setState({
    sessions: [session("a1", "scopeA", 1), session("b1", "scopeB", 2)],
  });
  useChatStore.getState().setActiveScope("scopeA");
  let resolveLoad!: (m: unknown[] | null) => void;
  sessions.loadMessages.mockImplementation(
    () =>
      new Promise<unknown[] | null>((resolve) => {
        resolveLoad = resolve;
      }),
  );

  useChatStore.getState().setActiveScope("scopeB");
  // While the load is in flight the scope is set but the session has not
  // flipped to the unread one: no empty Chat can be built over its file.
  expect(useChatStore.getState().activeScopeId).toBe("scopeB");
  expect(useChatStore.getState().activeSessionId).not.toBe("b1");

  resolveLoad([{ id: "m1", role: "user", parts: [] }]);
  await Promise.resolve();
  await Promise.resolve();

  expect(useChatStore.getState().activeSessionId).toBe("b1");
  expect(seedMessages.get("b1")).toHaveLength(1);
});

it("a superseded load never activates its session after a newer switch", async () => {
  useChatStore.setState({
    sessions: [
      session("a1", "scopeA", 1),
      session("b1", "scopeB", 2),
      session("c1", "scopeC", 3),
    ],
  });
  useChatStore.getState().setActiveScope("scopeA");
  const resolvers: Array<(m: unknown[] | null) => void> = [];
  sessions.loadMessages.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );

  useChatStore.getState().setActiveScope("scopeB");
  useChatStore.getState().setActiveScope("scopeC");

  // The scopeB load resolves last; it must not flip C's active session.
  resolvers[1]?.(null);
  await Promise.resolve();
  resolvers[0]?.([{ id: "m1", role: "user", parts: [] }]);
  await Promise.resolve();
  await Promise.resolve();

  const s = useChatStore.getState();
  expect(s.activeScopeId).toBe("scopeC");
  expect(s.activeSessionId).not.toBe("b1");
});

it("hydrate loads the persisted list without creating an unscoped placeholder", async () => {
  useChatStore.setState({ sessionsHydrated: false, sessions: [] });
  sessions.loadAll.mockResolvedValue({
    sessions: [session("a1", "scopeA", 1)],
    activeId: "a1",
  } as never);

  await useChatStore.getState().hydrateSessions();

  const s = useChatStore.getState();
  expect(s.sessionsHydrated).toBe(true);
  expect(s.sessions.map((x) => x.id)).toEqual(["a1"]);
  expect(s.activeSessionId).toBeNull();
  expect(sessions.saveSessionsList).not.toHaveBeenCalled();
});

it("a scope session created before hydration survives the disk load landing", async () => {
  // Startup order: App's synchronous tab effect runs setActiveScope
  // before the async hydrate lands. The fresh session it created must not
  // be clobbered by the disk list, and activeSessionId must stay valid.
  useChatStore.setState({ sessionsHydrated: false, sessions: [] });
  useChatStore.getState().setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("s-fresh-1"),
  );

  sessions.loadAll.mockResolvedValue({
    sessions: [session("disk1", "scopeOther", 5)],
    activeId: "disk1",
  } as never);
  sessions.loadMessages.mockResolvedValue([]);
  await useChatStore.getState().hydrateSessions();
  await vi.waitFor(() => {
    const s = useChatStore.getState();
    expect(s.activeSessionId).toBe("s-fresh-1");
    expect(s.sessions.some((x) => x.id === "s-fresh-1")).toBe(true);
    expect(s.sessions.some((x) => x.id === "disk1")).toBe(true);
  });
});

it("legacy disk sessions are adopted by the pre-hydration active scope and stay selectable", async () => {
  // The scope activated before any session existed, so reconcile created
  // s-fresh-1 for it; hydrate must keep that session (not clobber it with
  // the disk list) and adopt the legacy rows into the same scope.
  useChatStore.setState({ sessionsHydrated: false, sessions: [] });
  useChatStore.getState().setActiveScope("scopeA");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("s-fresh-1"),
  );

  sessions.loadAll.mockResolvedValue({
    sessions: [session("old1", "", 1), session("old2", "", 2)],
    activeId: "old2",
  } as never);
  sessions.loadMessages.mockResolvedValue([
    { id: "m1", role: "user", parts: [] },
  ]);
  await useChatStore.getState().hydrateSessions();

  await vi.waitFor(() => {
    const s = useChatStore.getState();
    // Every session now belongs to scopeA: the fresh one plus both legacy
    // rows adopted by this scope (the picker filter finds them, no null).
    expect(s.sessions.every((x) => x.scopeId === "scopeA")).toBe(true);
    expect(s.activeSessionId).toBe("s-fresh-1");
  });
  // Legacy conversations stay selectable through the normal path.
  useChatStore.getState().switchSession("old2");
  await vi.waitFor(() =>
    expect(useChatStore.getState().activeSessionId).toBe("old2"),
  );
});

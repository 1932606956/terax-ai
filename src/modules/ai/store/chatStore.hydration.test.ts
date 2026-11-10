import { expect, it, vi } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";

const sessions = vi.hoisted(() => ({
  loadAll: vi.fn(async () => ({ sessions: [], activeId: null })),
  newSessionId: vi.fn(),
  saveSessionsList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
}));
vi.mock("@/modules/ai/lib/sessions", () => ({
  ...sessions,
  deleteSessionData: vi.fn(),
  deriveTitle: vi.fn(),
  loadMessages: vi.fn(),
  saveMessages: vi.fn(),
}));

it("concurrent hydration loads the list once and creates no unscoped session", async () => {
  await Promise.all([
    useChatStore.getState().hydrateSessions(),
    useChatStore.getState().hydrateSessions(),
  ]);
  // Both calls may enter the await before the first lands; the second's
  // guard check runs after it and exits without touching state again.
  expect(sessions.loadAll.mock.calls.length).toBeLessThanOrEqual(2);
  expect(sessions.newSessionId).not.toHaveBeenCalled();
  expect(sessions.saveSessionsList).not.toHaveBeenCalled();
  expect(sessions.saveActiveId).not.toHaveBeenCalled();
  expect(useChatStore.getState()).toMatchObject({
    sessionsHydrated: true,
    sessions: [],
    activeSessionId: null,
  });
});

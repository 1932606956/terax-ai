import { expect, it, vi } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";

// Regression for "bottom-right AI control cannot collapse the panel":
// the status-bar collapse button relies on closePanel() leaving the panel
// closed (no re-open, no mini window side effects) so the normal AI open
// button state returns.
const sessions = vi.hoisted(() => ({
  loadAll: vi.fn(async () => ({ sessions: [], activeId: null })),
  newSessionId: vi.fn(() => "s-new"),
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

it("closePanel closes an open panel and leaves it closed", () => {
  const { openPanel, closePanel } = useChatStore.getState();
  openPanel();
  expect(useChatStore.getState().panelOpen).toBe(true);

  closePanel();
  expect(useChatStore.getState().panelOpen).toBe(false);
});

it("closePanel does not touch the mini window", () => {
  const { openMini, closePanel } = useChatStore.getState();
  openMini();
  expect(useChatStore.getState().mini.open).toBe(true);

  closePanel();
  expect(useChatStore.getState().mini.open).toBe(true);
  expect(useChatStore.getState().panelOpen).toBe(false);
});

it("collapse then open via toggle restores the panel", () => {
  const { openPanel, closePanel, togglePanel } = useChatStore.getState();
  openPanel();
  closePanel();
  expect(useChatStore.getState().panelOpen).toBe(false);

  togglePanel();
  expect(useChatStore.getState().panelOpen).toBe(true);
});

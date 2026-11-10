import type { Tab } from "@/modules/tabs";
import { expect, it } from "vitest";
import { scopeContextTerminal } from "./scopeContext";

const term = (id: number, scopeId: string): Tab => ({
  id,
  kind: "terminal",
  spaceId: "sp",
  scopeId,
  title: `t${id}`,
  paneTree: { kind: "leaf", id: id * 10 },
  activeLeafId: id * 10,
});

const diffTab = (id: number, scopeId: string): Tab => ({
  id,
  kind: "ai-diff",
  spaceId: "sp",
  scopeId,
  title: "diff",
  path: "p",
  originalContent: "",
  proposedContent: "",
  approvalId: "ap1",
  status: "pending",
  isNewFile: false,
});

it("returns the active terminal when it belongs to the scope", () => {
  const tabs = [term(1, "A"), term(2, "A"), term(3, "B")];
  expect(scopeContextTerminal(tabs, 2, "A")?.id).toBe(2);
});

it("never falls back to a terminal of another scope", () => {
  const tabs = [term(1, "B"), term(2, "B")];
  expect(scopeContextTerminal(tabs, 9, "A")).toBeNull();
});

it("falls back to the most recent terminal of the same scope when the active tab is not a terminal", () => {
  const tabs = [term(1, "A"), diffTab(2, "A"), term(3, "B")];
  expect(scopeContextTerminal(tabs, 2, "A")?.id).toBe(1);
});

it("treats a null scope as the whole tab list", () => {
  const tabs = [term(1, "A"), term(2, "B")];
  expect(scopeContextTerminal(tabs, 2, null)?.id).toBe(2);
  expect(scopeContextTerminal(tabs, 9, null)?.id).toBe(2);
});

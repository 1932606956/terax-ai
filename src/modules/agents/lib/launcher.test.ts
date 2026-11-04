import { leafIds } from "@/modules/terminal";
import { describe, expect, it } from "vitest";
import {
  type AgentInstanceCount,
  createAgentPanePlan,
  DEFAULT_AGENT_LAUNCHERS,
  normalizeAgentLaunchers,
  validateAgentLaunchCommand,
} from "./launcher";

function allocator(start = 1) {
  let id = start;
  return () => id++;
}

describe("agent launchers", () => {
  it("ships only the two built-in agents, each with a command", () => {
    expect(DEFAULT_AGENT_LAUNCHERS.map((a) => a.id)).toEqual([
      "dsh-tui",
      "oh-my-pi",
    ]);
    for (const launcher of DEFAULT_AGENT_LAUNCHERS) {
      expect(launcher.command.trim().length).toBeGreaterThan(0);
      expect(launcher.builtIn).toBe(true);
    }
  });

  it("accepts aliases and arguments while trimming whitespace", () => {
    expect(validateAgentLaunchCommand("  omp --model local  ")).toEqual({
      ok: true,
      command: "omp --model local",
    });
  });

  it("rejects blank, multiline, and oversized commands", () => {
    expect(validateAgentLaunchCommand(" ")).toMatchObject({ ok: false });
    expect(validateAgentLaunchCommand("omp\nwhoami")).toMatchObject({
      ok: false,
    });
    expect(validateAgentLaunchCommand("x".repeat(257))).toEqual({
      ok: false,
      error: "命令长度请保持在 256 个字符以内。",
    });
  });

  it("falls back to the built-ins when nothing usable is persisted", () => {
    expect(normalizeAgentLaunchers(null).map((a) => a.id)).toEqual([
      "dsh-tui",
      "oh-my-pi",
    ]);
    expect(
      normalizeAgentLaunchers([{ id: "x", command: "   " }]).map((a) => a.id),
    ).toEqual(["dsh-tui", "oh-my-pi"]);
  });

  it("keeps user-added agents and their labels across a reload", () => {
    const stored = [
      { id: "dsh-tui", label: "dsh-tui", command: "dsh-tui" },
      { id: "oh-my-pi", label: "oh-my-pi", command: "omp" },
      { id: "custom-1", label: "My Agent", command: "my-agent --flag" },
    ];
    const out = normalizeAgentLaunchers(stored);
    expect(out.map((a) => a.id)).toEqual(["dsh-tui", "oh-my-pi", "custom-1"]);
    expect(out[2]).toMatchObject({
      label: "My Agent",
      command: "my-agent --flag",
      builtIn: false,
    });
  });

  it("derives a label from the command and drops duplicate ids", () => {
    const out = normalizeAgentLaunchers([
      { id: "a", command: "first-word --x" },
      { id: "a", command: "second" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("first-word");
    expect(out[0].builtIn).toBe(false);
  });
});

describe("createAgentPanePlan", () => {
  it.each([1, 2, 3, 4] as AgentInstanceCount[])(
    "creates %i unique leaves with the requested cwd",
    (instances) => {
      const plan = createAgentPanePlan(instances, allocator(), "/workspace");
      const ids = leafIds(plan.paneTree);
      expect(ids).toEqual(plan.leafIds);
      expect(new Set(ids).size).toBe(instances);

      const visit = (node: typeof plan.paneTree) => {
        if (node.kind === "leaf") {
          expect(node.cwd).toBe("/workspace");
          return;
        }
        node.children.forEach(visit);
      };
      visit(plan.paneTree);
    },
  );

  it("balances four agents into a two by two grid", () => {
    const { paneTree } = createAgentPanePlan(4, allocator());
    expect(paneTree.kind).toBe("split");
    if (paneTree.kind !== "split") return;
    expect(paneTree.dir).toBe("row");
    expect(paneTree.children).toHaveLength(2);
    expect(
      paneTree.children.every(
        (child) =>
          child.kind === "split" &&
          child.dir === "col" &&
          child.children.length === 2,
      ),
    ).toBe(true);
  });

  it("rejects counts outside the renderer pool limit", () => {
    expect(() =>
      createAgentPanePlan(0 as AgentInstanceCount, allocator()),
    ).toThrow(RangeError);
    expect(() =>
      createAgentPanePlan(5 as AgentInstanceCount, allocator()),
    ).toThrow(RangeError);
  });
});

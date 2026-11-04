import { t } from "@/i18n/zh";
import type { PaneNode } from "@/modules/terminal";

/**
 * One launchable agent entry. The built-in pair ships with Terax; users add
 * their own from the launch panel and the whole list round-trips through
 * preferences, so a custom entry survives restarts like the built-in ones.
 */
export type AgentLauncher = {
  id: string;
  label: string;
  command: string;
  /** Rust-side hook integration exists only for the built-ins it knows. */
  supportsHooks: boolean;
  builtIn: boolean;
};

export const DEFAULT_AGENT_LAUNCHERS: readonly AgentLauncher[] = [
  {
    id: "dsh-tui",
    label: "dsh-tui",
    command: "dsh-tui",
    supportsHooks: false,
    builtIn: true,
  },
  {
    id: "oh-my-pi",
    label: "oh-my-pi",
    command: "omp",
    supportsHooks: false,
    builtIn: true,
  },
] as const;

export type AgentInstanceCount = 1 | 2 | 3 | 4;

export type AgentLaunchRequest = {
  agent: string;
  label: string;
  command: string;
  supportsHooks: boolean;
  instances: AgentInstanceCount;
};

export const DEFAULT_AGENT_INSTANCES: AgentInstanceCount = 1;

const MAX_AGENT_COMMAND_LENGTH = 256;
const MAX_AGENT_LABEL_LENGTH = 40;
const MAX_AGENTS = 24;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type AgentCommandValidation =
  | { ok: true; command: string }
  | { ok: false; error: string };

export function validateAgentLaunchCommand(
  value: unknown,
): AgentCommandValidation {
  if (typeof value !== "string") {
    return { ok: false, error: t("ag.errEmptyCommand") };
  }
  const command = value.trim();
  if (!command) return { ok: false, error: t("ag.errEmptyCommand") };
  if (command.length > MAX_AGENT_COMMAND_LENGTH) {
    return {
      ok: false,
      error: t("ag.errCommandTooLong", String(MAX_AGENT_COMMAND_LENGTH)),
    };
  }
  if (CONTROL_CHARACTERS.test(command)) {
    return { ok: false, error: t("ag.errSingleLine") };
  }
  return { ok: true, command };
}

export function newCustomAgentId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Default label for a fresh custom entry: the command's first word. */
export function defaultAgentLabel(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return first.slice(0, MAX_AGENT_LABEL_LENGTH);
}

function normalizeLabel(value: unknown, fallback: string): string {
  const label =
    typeof value === "string"
      ? value.trim().slice(0, MAX_AGENT_LABEL_LENGTH)
      : "";
  return label || fallback;
}

/**
 * Turns whatever was persisted into a usable launcher list: drops entries with
 * an unusable command, keeps ids unique, and falls back to the built-ins when
 * nothing survives (a fresh install, or a hand-edited settings file).
 */
export function normalizeAgentLaunchers(value: unknown): AgentLauncher[] {
  const stored = Array.isArray(value) ? value : [];
  const out: AgentLauncher[] = [];
  const seen = new Set<string>();
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const result = validateAgentLaunchCommand(entry.command);
    if (!result.ok) continue;
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim().slice(0, 64)
        : newCustomAgentId();
    if (seen.has(id)) continue;
    seen.add(id);
    const builtIn = DEFAULT_AGENT_LAUNCHERS.some((x) => x.id === id);
    out.push({
      id,
      label: normalizeLabel(entry.label, defaultAgentLabel(result.command)),
      command: result.command,
      supportsHooks: builtIn && entry.supportsHooks === true,
      builtIn,
    });
    if (out.length >= MAX_AGENTS) break;
  }
  if (out.length > 0) return out;
  return DEFAULT_AGENT_LAUNCHERS.map((x) => ({ ...x }));
}

export function findAgentLauncher(
  launchers: readonly AgentLauncher[],
  id: string,
): AgentLauncher {
  return launchers.find((agent) => agent.id === id) ?? launchers[0];
}

export type AgentPanePlan = {
  paneTree: PaneNode;
  leafIds: number[];
};

export function createAgentPanePlan(
  instances: AgentInstanceCount,
  allocateId: () => number,
  cwd?: string,
): AgentPanePlan {
  if (!Number.isInteger(instances) || instances < 1 || instances > 4) {
    throw new RangeError("Agent instance count must be between 1 and 4.");
  }

  const leaves = Array.from({ length: instances }, () => ({
    kind: "leaf" as const,
    id: allocateId(),
    cwd,
  }));
  const split = (dir: "row" | "col", children: PaneNode[]): PaneNode => ({
    kind: "split",
    id: allocateId(),
    dir,
    children,
  });

  switch (instances) {
    case 1:
      return { paneTree: leaves[0], leafIds: leaves.map((leaf) => leaf.id) };
    case 2:
      return {
        paneTree: split("row", leaves),
        leafIds: leaves.map((leaf) => leaf.id),
      };
    case 3:
      return {
        paneTree: split("row", [
          leaves[0],
          split("col", [leaves[1], leaves[2]]),
        ]),
        leafIds: leaves.map((leaf) => leaf.id),
      };
    default:
      return {
        paneTree: split("row", [
          split("col", [leaves[0], leaves[1]]),
          split("col", [leaves[2], leaves[3]]),
        ]),
        leafIds: leaves.map((leaf) => leaf.id),
      };
  }
}

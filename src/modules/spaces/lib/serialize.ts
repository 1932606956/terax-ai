import { createTabScopeId } from "@/modules/tabs/lib/tabScope";
import type {
  EditorTab,
  MarkdownTab,
  PreviewTab,
  Tab,
  TerminalTab,
} from "@/modules/tabs/lib/useTabs";
import {
  isLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
type SerializedNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

export type SerializedTab =
  | {
      kind: "terminal";
      scopeId?: string;
      tree: SerializedNode;
      blocks?: boolean;
      locked?: boolean;
      customTitle?: string;
      customColor?: string;
    }
  | { kind: "editor"; scopeId?: string; path: string }
  | { kind: "preview"; scopeId?: string; url: string }
  | { kind: "markdown"; scopeId?: string; path: string };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function serializeNode(node: PaneNode, activeLeafId: number): SerializedNode {
  if (isLeaf(node)) {
    return {
      kind: "leaf",
      ...(node.cwd !== undefined && { cwd: node.cwd }),
      ...(node.id === activeLeafId && { active: true }),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => serializeNode(c, activeLeafId)),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    case "editor":
    case "preview":
    case "markdown":
      return true;
    default:
      return false;
  }
}

/**
 * Save-path predicate: only locked terminal tabs survive a restart.
 * Locking is a terminal-only concept, so editors, previews, markdown and
 * unlocked terminals are all dropped by the save path. Private terminals
 * stay excluded even when locked.
 */
export function isPersistedTab(tab: Tab): boolean {
  return tab.kind === "terminal" && tab.locked === true && !tab.private;
}

/**
 * Index of the active tab within the persisted (locked-only) order, or -1
 * when the active tab itself is not persisted. Callers keep the stored index
 * on -1 so an active unlocked tab never corrupts the saved pointer.
 */
export function persistedActiveIndex(tabs: Tab[], activeId: number): number {
  return tabs.filter(isPersistedTab).findIndex((t) => t.id === activeId);
}

/**
 * Per-space saved state under the locked-only policy: the serialized locked
 * tabs plus an active pointer remapped into the surviving order. A stored
 * pointer that aimed at a dropped tab clamps into range, and an empty space
 * saves index 0 so restore starts from a valid state. Pass null activeId for
 * spaces that are not active to keep their stored pointer.
 */
export function persistedSpaceState(
  tabs: Tab[],
  activeId: number | null,
  storedIndex: number,
): { tabs: SerializedTab[]; activeTabIndex: number } {
  const serialized = serializeTabs(tabs);
  const idx = activeId === null ? -1 : persistedActiveIndex(tabs, activeId);
  const next = idx >= 0 ? idx : storedIndex;
  const activeTabIndex =
    serialized.length === 0
      ? 0
      : Math.min(Math.max(next, 0), serialized.length - 1);
  return { tabs: serialized, activeTabIndex };
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  switch (tab.kind) {
    case "terminal":
      return {
        kind: "terminal",
        scopeId: tab.scopeId,
        tree: serializeNode(tab.paneTree, tab.activeLeafId),
        ...(tab.blocks && { blocks: true }),
        ...(tab.locked && { locked: true }),
        ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
        ...(tab.customColor !== undefined && { customColor: tab.customColor }),
      };
    case "editor":
      return { kind: "editor", scopeId: tab.scopeId, path: tab.path };
    case "preview":
      return { kind: "preview", scopeId: tab.scopeId, url: tab.url };
    case "markdown":
      return { kind: "markdown", scopeId: tab.scopeId, path: tab.path };
    default:
      return null;
  }
}

export function serializeTabs(tabs: Tab[]): SerializedTab[] {
  const out: SerializedTab[] = [];
  for (const tab of tabs) {
    // Save path: only locked tabs survive a restart. Unlocked tabs leave
    // no trace in the persisted state.
    if (!isPersistedTab(tab)) continue;
    const s = serializeTab(tab);
    if (s) out.push(s);
  }
  return out;
}

type HydratedTree = {
  tree: PaneNode;
  activeLeafId: number;
  firstLeafCwd?: string;
};

function hydrateNode(
  node: SerializedNode,
  allocId: () => number,
  acc: { activeLeafId: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocId();
    if (node.active && acc.activeLeafId === null) acc.activeLeafId = id;
    return {
      kind: "leaf",
      id,
      ...(node.cwd !== undefined && { cwd: node.cwd }),
    };
  }
  const children = node.children.map((c) => hydrateNode(c, allocId, acc));
  if (children.length === 0) return { kind: "leaf", id: allocId() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

function hydrateTree(
  tree: SerializedNode,
  allocId: () => number,
): HydratedTree {
  const acc: { activeLeafId: number | null } = { activeLeafId: null };
  const paneTree = hydrateNode(tree, allocId, acc);
  const leaves = collectLeaves(paneTree);
  const activeLeafId = acc.activeLeafId ?? leaves[0]?.id ?? allocId();
  const firstLeafCwd =
    leaves.find((l) => l.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
  return { tree: paneTree, activeLeafId, firstLeafCwd };
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateTab(
  s: SerializedTab,
  spaceId: string,
  allocId: () => number,
): Tab | null {
  switch (s.kind) {
    case "terminal": {
      const { tree, activeLeafId, firstLeafCwd } = hydrateTree(s.tree, allocId);
      const title =
        s.customTitle ??
        (firstLeafCwd ? basename(firstLeafCwd) : s.blocks ? "blocks" : "shell");
      return {
        id: allocId(),
        kind: "terminal",
        spaceId,
        scopeId: s.scopeId ?? createTabScopeId(),
        cold: true,
        title,
        cwd: firstLeafCwd,
        paneTree: tree,
        activeLeafId,
        ...(s.blocks && { blocks: true }),
        ...(s.locked && { locked: true }),
        ...(s.customTitle !== undefined && { customTitle: s.customTitle }),
        ...(s.customColor !== undefined && { customColor: s.customColor }),
      } satisfies TerminalTab;
    }
    case "editor":
      return {
        id: allocId(),
        kind: "editor",
        spaceId,
        scopeId: s.scopeId ?? createTabScopeId(),
        cold: true,
        title: basename(s.path),
        path: s.path,
        dirty: false,
        preview: false,
      } satisfies EditorTab;
    case "preview":
      return {
        id: allocId(),
        kind: "preview",
        spaceId,
        scopeId: s.scopeId ?? createTabScopeId(),
        cold: true,
        title: titleFromUrl(s.url),
        url: s.url,
      } satisfies PreviewTab;
    case "markdown":
      return {
        id: allocId(),
        kind: "markdown",
        spaceId,
        scopeId: s.scopeId ?? createTabScopeId(),
        cold: true,
        title: basename(s.path),
        path: s.path,
      } satisfies MarkdownTab;
    default:
      return null;
  }
}

export function freshTerminalTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): TerminalTab {
  const leafId = allocId();
  return {
    id: allocId(),
    kind: "terminal",
    spaceId,
    scopeId: createTabScopeId(),
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd && { cwd }) },
    activeLeafId: leafId,
  };
}

export function hydrateTabs(
  serialized: SerializedTab[],
  spaceId: string,
  allocId: () => number,
): Tab[] {
  if (!Array.isArray(serialized)) return [];
  const out: Tab[] = [];
  for (const s of serialized) {
    try {
      const tab = hydrateTab(s, spaceId, allocId);
      if (tab) out.push(tab);
    } catch {
      // Skip corrupted entries rather than failing the whole restore.
    }
  }
  return out;
}

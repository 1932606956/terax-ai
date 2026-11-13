import { create } from "zustand";

/** Which diff side a peek diff tab compares. Mirrors the git panel's mode. */
export type PeekDiffSource =
  | {
      kind: "working";
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
    }
  | {
      kind: "commit";
      repoRoot: string;
      sha: string;
      path: string;
      originalPath: string | null;
    };

export type PeekTab = {
  id: string;
  path: string;
  dirty: boolean;
  /**
   * Diff tabs show the change against a git revision instead of the file's
   * current contents; their editor is read-only. Absent for file tabs.
   */
  diff?: PeekDiffSource;
};

/** The peek card of one workspace tab: its own tab strip and active tab. */
export type PeekArea = {
  tabs: PeekTab[];
  activeId: string | null;
};

let nextSeq = 1;

function allocId(): string {
  return `peek-${nextSeq++}`;
}

/** Two diffs of the same path differ per repo/side/revision; file tabs key on path. */
function tabKey(path: string, diff?: PeekDiffSource): string {
  if (!diff) return path;
  if (diff.kind === "working") {
    return `${diff.repoRoot}\u0000${diff.path}\u0000working\u0000${diff.mode}\u0000${diff.originalPath ?? ""}`;
  }
  return `${diff.repoRoot}\u0000${diff.path}\u0000commit\u0000${diff.sha}\u0000${diff.originalPath ?? ""}`;
}

function nextActive(tabs: PeekTab[], closingId: string): string | null {
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx < 0) return null;
  const neighbor = tabs[idx + 1] ?? tabs[idx - 1];
  return neighbor ? neighbor.id : null;
}

const EMPTY: PeekArea = { tabs: [], activeId: null };

/** Read-only view of an area; the empty area is shared so selectors stay stable. */
export function peekArea(
  areas: Record<string, PeekArea>,
  scopeId: string | null,
): PeekArea {
  if (scopeId === null) return EMPTY;
  return areas[scopeId] ?? EMPTY;
}

type PeekState = {
  /** One peek card per workspace tab, keyed by that tab's scope id. */
  areas: Record<string, PeekArea>;
  /** Same path: idempotent activate. New path: append and activate. */
  open: (path: string, scopeId: string) => void;
  /** Opens (or re-activates) a diff view for a git-noted change. */
  openDiff: (diff: PeekDiffSource, scopeId: string) => void;
  /** Returns false when the tab is dirty and the caller must confirm first. */
  close: (id: string) => boolean;
  /** Removes regardless of dirty state (used after user confirmation). */
  forceClose: (id: string) => void;
  /** Returns false when any tab of the scope is dirty and the caller must confirm first. */
  closeAll: (scopeId: string) => boolean;
  /** Removes every tab of the scope regardless of dirty state. */
  clear: (scopeId: string) => void;
  /** Returns false when any OTHER tab of the scope is dirty and the caller must confirm first. */
  closeOthers: (scopeId: string, id: string) => boolean;
  /** Drops every tab of the scope except `id`, regardless of dirty state. */
  forceCloseOthers: (scopeId: string, id: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
  setActive: (scopeId: string, id: string) => void;
  /** Mirror an explorer rename into the peek tab's path. */
  renamePath: (from: string, to: string) => void;
  /** Drop peek tabs for a deleted path (mirrors top-bar tab behavior). */
  removePath: (path: string) => void;
  /** Drop a closing workspace tab's peek card; its unsaved edits go with it. */
  dropScope: (scopeId: string) => void;
  /** Whether a scope holds a peek tab with unsaved edits. */
  scopeDirty: (scopeId: string) => boolean;
};

/**
 * Applies `edit` to the area owning `id`, leaving every other area untouched.
 * Returns null when nothing changed, so callers keep the previous state object.
 */
function mapOwningArea(
  areas: Record<string, PeekArea>,
  id: string,
  edit: (area: PeekArea) => PeekArea,
): Record<string, PeekArea> | null {
  for (const [scopeId, area] of Object.entries(areas)) {
    if (!area.tabs.some((t) => t.id === id)) continue;
    const next = edit(area);
    if (next === area) return null;
    if (next.tabs.length === 0) {
      const { [scopeId]: _dropped, ...rest } = areas;
      return rest;
    }
    return { ...areas, [scopeId]: next };
  }
  return null;
}

function appendTab(
  areas: Record<string, PeekArea>,
  scopeId: string,
  tab: PeekTab,
): Record<string, PeekArea> {
  const area = areas[scopeId] ?? EMPTY;
  return {
    ...areas,
    [scopeId]: { tabs: [...area.tabs, tab], activeId: tab.id },
  };
}

function activate(
  areas: Record<string, PeekArea>,
  scopeId: string,
  id: string,
): Record<string, PeekArea> {
  const area = areas[scopeId] ?? EMPTY;
  return { ...areas, [scopeId]: { ...area, activeId: id } };
}

export const usePeekStore = create<PeekState>((set, get) => ({
  areas: {},
  open: (path, scopeId) =>
    set((s) => {
      const area = s.areas[scopeId];
      const existing = area?.tabs.find((t) => t.path === path);
      if (existing) return { areas: activate(s.areas, scopeId, existing.id) };
      return {
        areas: appendTab(s.areas, scopeId, {
          id: allocId(),
          path,
          dirty: false,
        }),
      };
    }),
  openDiff: (diff, scopeId) =>
    set((s) => {
      const wanted = tabKey(diff.path, diff);
      const existing = s.areas[scopeId]?.tabs.find(
        (t) => tabKey(t.path, t.diff) === wanted,
      );
      if (existing) return { areas: activate(s.areas, scopeId, existing.id) };
      return {
        areas: appendTab(s.areas, scopeId, {
          id: allocId(),
          path: diff.path,
          dirty: false,
          diff,
        }),
      };
    }),
  close: (id) => {
    let blocked = false;
    set((s) => {
      const areas = mapOwningArea(s.areas, id, (area) => {
        const tab = area.tabs.find((t) => t.id === id);
        if (!tab) return area;
        if (tab.dirty) {
          blocked = true;
          return area;
        }
        return {
          tabs: area.tabs.filter((t) => t.id !== id),
          activeId:
            area.activeId === id ? nextActive(area.tabs, id) : area.activeId,
        };
      });
      return areas === null ? s : { areas };
    });
    return !blocked;
  },
  forceClose: (id) =>
    set((s) => {
      const areas = mapOwningArea(s.areas, id, (area) => ({
        tabs: area.tabs.filter((t) => t.id !== id),
        activeId:
          area.activeId === id ? nextActive(area.tabs, id) : area.activeId,
      }));
      return areas === null ? s : { areas };
    }),
  closeOthers: (scopeId, id) => {
    let blocked = false;
    set((s) => {
      const area = s.areas[scopeId];
      const kept = area?.tabs.find((t) => t.id === id);
      if (!area || !kept) return s;
      if (area.tabs.some((t) => t.id !== id && t.dirty)) {
        blocked = true;
        return s;
      }
      return {
        areas: { ...s.areas, [scopeId]: { tabs: [kept], activeId: id } },
      };
    });
    return !blocked;
  },
  forceCloseOthers: (scopeId, id) =>
    set((s) => {
      const area = s.areas[scopeId];
      const kept = area?.tabs.find((t) => t.id === id);
      if (!area || !kept) return s;
      return {
        areas: { ...s.areas, [scopeId]: { tabs: [kept], activeId: id } },
      };
    }),
  closeAll: (scopeId) => {
    let blocked = false;
    set((s) => {
      const area = s.areas[scopeId];
      if (!area) return s;
      if (area.tabs.some((t) => t.dirty)) {
        blocked = true;
        return s;
      }
      const { [scopeId]: _cleared, ...rest } = s.areas;
      return { areas: rest };
    });
    return !blocked;
  },
  clear: (scopeId) =>
    set((s) => {
      if (!s.areas[scopeId]) return s;
      const { [scopeId]: _cleared, ...rest } = s.areas;
      return { areas: rest };
    }),
  setDirty: (id, dirty) =>
    set((s) => {
      const areas = mapOwningArea(s.areas, id, (area) => {
        const tab = area.tabs.find((t) => t.id === id);
        if (!tab || tab.dirty === dirty) return area;
        return {
          ...area,
          tabs: area.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
        };
      });
      return areas === null ? s : { areas };
    }),
  setActive: (scopeId, id) =>
    set((s) => {
      const area = s.areas[scopeId];
      if (!area?.tabs.some((t) => t.id === id)) return s;
      return { areas: activate(s.areas, scopeId, id) };
    }),
  renamePath: (from, to) =>
    set((s) => {
      let changed = false;
      const areas: Record<string, PeekArea> = {};
      for (const [scopeId, area] of Object.entries(s.areas)) {
        if (!area.tabs.some((t) => t.path === from)) {
          areas[scopeId] = area;
          continue;
        }
        changed = true;
        areas[scopeId] = {
          ...area,
          tabs: area.tabs.map((t) =>
            t.path === from ? { ...t, path: to } : t,
          ),
        };
      }
      return changed ? { areas } : s;
    }),
  removePath: (path) =>
    set((s) => {
      let changed = false;
      const areas: Record<string, PeekArea> = {};
      for (const [scopeId, area] of Object.entries(s.areas)) {
        if (!area.tabs.some((t) => t.path === path)) {
          areas[scopeId] = area;
          continue;
        }
        changed = true;
        const active = area.tabs.find((t) => t.id === area.activeId);
        const tabs = area.tabs.filter((t) => t.path !== path);
        if (tabs.length === 0) continue;
        areas[scopeId] = {
          tabs,
          activeId:
            active?.path === path
              ? nextActive(area.tabs, active.id)
              : area.activeId,
        };
      }
      return changed ? { areas } : s;
    }),
  dropScope: (scopeId) =>
    set((s) => {
      if (!s.areas[scopeId]) return s;
      const { [scopeId]: _dropped, ...rest } = s.areas;
      return { areas: rest };
    }),
  scopeDirty: (scopeId) =>
    (get().areas[scopeId]?.tabs ?? []).some((t) => t.dirty),
}));

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

type PeekState = {
  tabs: PeekTab[];
  activeId: string | null;
  activeSpaceId: string | null;
  /** Same path: idempotent activate. New path: append and activate. */
  open: (path: string, spaceId: string | null) => void;
  /** Opens (or re-activates) a diff view for a git-noted change. */
  openDiff: (diff: PeekDiffSource, spaceId: string | null) => void;
  /** Returns false when the tab is dirty and the caller must confirm first. */
  close: (id: string) => boolean;
  /** Removes regardless of dirty state (used after user confirmation). */
  forceClose: (id: string) => void;
  /** Returns false when any tab is dirty and the caller must confirm first. */
  closeAll: () => boolean;
  /** Removes every tab regardless of dirty state. */
  clear: () => void;
  /** Returns false when any OTHER tab is dirty and the caller must confirm first. */
  closeOthers: (id: string) => boolean;
  setDirty: (id: string, dirty: boolean) => void;
  setActive: (id: string) => void;
  /** Mirror an explorer rename into the peek tab's path. */
  renamePath: (from: string, to: string) => void;
  /** Drop peek tabs for a deleted path (mirrors top-bar tab behavior). */
  removePath: (path: string) => void;
};

export const usePeekStore = create<PeekState>((set) => ({
  tabs: [],
  activeId: null,
  activeSpaceId: null,
  open: (path, spaceId) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path);
      if (existing) {
        return { activeId: existing.id, activeSpaceId: spaceId };
      }
      const tab: PeekTab = { id: allocId(), path, dirty: false };
      return {
        tabs: [...s.tabs, tab],
        activeId: tab.id,
        activeSpaceId: spaceId,
      };
    }),
  openDiff: (diff, spaceId) =>
    set((s) => {
      const wanted = tabKey(diff.path, diff);
      const existing = s.tabs.find((t) => tabKey(t.path, t.diff) === wanted);
      if (existing) {
        return { activeId: existing.id, activeSpaceId: spaceId };
      }
      const tab: PeekTab = {
        id: allocId(),
        path: diff.path,
        dirty: false,
        diff,
      };
      return {
        tabs: [...s.tabs, tab],
        activeId: tab.id,
        activeSpaceId: spaceId,
      };
    }),
  close: (id) => {
    let blocked = false;
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      if (tab.dirty) {
        blocked = true;
        return s;
      }
      return {
        tabs: s.tabs.filter((t) => t.id !== id),
        activeId: s.activeId === id ? nextActive(s.tabs, id) : s.activeId,
      };
    });
    return !blocked;
  },
  forceClose: (id) =>
    set((s) => {
      if (!s.tabs.some((t) => t.id === id)) return s;
      return {
        tabs: s.tabs.filter((t) => t.id !== id),
        activeId: s.activeId === id ? nextActive(s.tabs, id) : s.activeId,
      };
    }),
  closeOthers: (id) => {
    let blocked = false;
    set((s) => {
      const kept = s.tabs.find((t) => t.id === id);
      if (!kept) return s;
      if (s.tabs.some((t) => t.id !== id && t.dirty)) {
        blocked = true;
        return s;
      }
      return { tabs: [kept], activeId: id };
    });
    return !blocked;
  },
  closeAll: () => {
    let blocked = false;
    set((s) => {
      if (s.tabs.length === 0) return s;
      if (s.tabs.some((t) => t.dirty)) {
        blocked = true;
        return s;
      }
      return { tabs: [], activeId: null };
    });
    return !blocked;
  },
  clear: () => set({ tabs: [], activeId: null }),
  setDirty: (id, dirty) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab || tab.dirty === dirty) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
      };
    }),
  setActive: (id) =>
    set((s) => (s.tabs.some((t) => t.id === id) ? { activeId: id } : s)),
  renamePath: (from, to) =>
    set((s) => {
      if (!s.tabs.some((t) => t.path === from)) return s;
      return {
        tabs: s.tabs.map((t) => (t.path === from ? { ...t, path: to } : t)),
      };
    }),
  removePath: (path) =>
    set((s) => {
      if (!s.tabs.some((t) => t.path === path)) return s;
      const active = s.tabs.find((t) => t.id === s.activeId);
      return {
        tabs: s.tabs.filter((t) => t.path !== path),
        activeId:
          active?.path === path ? nextActive(s.tabs, active.id) : s.activeId,
      };
    }),
}));

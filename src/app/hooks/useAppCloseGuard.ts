import { t } from "@/i18n/zh";
import {
  type FlushResult,
  flushSessionWrites,
} from "@/modules/ai/lib/sessions";
import { flushPersist } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

async function anyTerminalBusy(tabs: Tab[]): Promise<boolean> {
  const leaves = tabs.flatMap((t) =>
    t.kind === "terminal" ? leafIds(t.paneTree) : [],
  );
  if (leaves.length === 0) return false;
  const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
  return checks.some(Boolean);
}

/** How long closing waits for chat history to reach the disk. */
export const CLOSE_FLUSH_TIMEOUT_MS = 4_000;

/**
 * Failing to save chat history must never make the window impossible to close.
 * The first failed flush keeps the window open once, with a visible error and a
 * "Close anyway" action; any further close request closes immediately.
 */
export function closeAfterFlush(
  flush: Pick<FlushResult, "ok" | "failed">,
  alreadyWarned: boolean,
): "close" | "warn" {
  // Only block the close when conversations genuinely failed to write.
  // A drain timeout or metadata save hiccup without failed writes means the
  // data is on disk; blocking then would trap the exit behind a toast.
  if (flush.failed.length > 0) return alreadyWarned ? "close" : "warn";
  return "close";
}

export type AppCloseBlocker = {
  dirtyEditors: number;
  busyTerminal: boolean;
};

/**
 * The opt-out only covers running processes, so it stays hidden whenever the
 * same prompt is also the last warning before discarding unsaved buffers.
 */
export function canOptOutOfAppClosePrompt(blocker: AppCloseBlocker): boolean {
  return blocker.busyTerminal && blocker.dirtyEditors === 0;
}

export function useAppCloseGuard(tabsRef: RefObject<Tab[]>) {
  const [pendingAppClose, setPendingAppClose] =
    useState<AppCloseBlocker | null>(null);
  const forceClose = useRef(false);
  const closing = useRef(false);
  const forceExitTimer = useRef<number | undefined>(undefined);
  const warned = useRef(false);
  const closeWindow = useCallback(async () => {
    forceClose.current = true;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      forceClose.current = false;
      toast.error(t("toast.closeWindowFailed"), {
        description: String(error),
      });
    }
  }, []);
  const finishClose = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      flushPersist();
      const flush = await flushSessionWrites({
        timeoutMs: CLOSE_FLUSH_TIMEOUT_MS,
      });
      if (closeAfterFlush(flush, warned.current) === "warn") {
        warned.current = true;
        toast.error(t("toast.saveChatFailed"), {
          id: "close-save-failed",
          duration: Number.POSITIVE_INFINITY,
          description: flush.timedOut
            ? t("close.saveTooLong")
            : t("close.messagesLost"),
          action: {
            label: t("close.anyway"),
            onClick: () => {
              clearTimeout(forceExitTimer.current);
              void closeWindow();
            },
          },
        });
        // The toast must never be the only way out: if it goes unnoticed
        // the window would stay open forever after a close request.
        forceExitTimer.current = window.setTimeout(
          () => void closeWindow(),
          5_000,
        );
        return;
      }
      await closeWindow();
    } finally {
      closing.current = false;
    }
  }, [closeWindow]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        // Opting out skips the per-leaf IPC entirely; it never relaxes the
        // unsaved-changes guard below.
        const busyTerminal =
          usePreferencesStore.getState().confirmCloseRunningTerminal &&
          (await anyTerminalBusy(tabsRef.current));
        // Count after the await so edits made during the IPC check are seen.
        const dirtyEditors = tabsRef.current.filter(
          (t) => t.kind === "editor" && t.dirty,
        ).length;
        if (dirtyEditors > 0 || busyTerminal) {
          setPendingAppClose({ dirtyEditors, busyTerminal });
        } else {
          void finishClose();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabsRef, finishClose]);

  const confirmAppClose = useCallback(() => {
    setPendingAppClose(null);
    void finishClose();
  }, [finishClose]);

  const cancelAppClose = useCallback(() => setPendingAppClose(null), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}

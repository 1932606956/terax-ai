import { useEffect, useRef } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  focusedLeafAlternateScreen,
  isTerminalSurfaceTarget,
} from "@/modules/terminal";
import { SHORTCUTS, type ShortcutId } from "../shortcuts";
import { resolveShortcut } from "./resolveShortcut";
import { shouldSuppressShortcut } from "./suppression";

type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

export type UseGlobalShortcutsOptions = {
  isDisabled?: (id: ShortcutId, e: KeyboardEvent) => boolean;
};

/**
 * Platform shortcuts are captured at window level before the terminal sees
 * them. A TUI (vim, htop, ...) needs its own Ctrl chords, so the
 * shortcutSuppression preference lets the event fall through to the terminal
 * instead: never preventDefault, never stop propagation.
 */
export function useGlobalShortcuts(
  handlers: ShortcutHandlers,
  options?: UseGlobalShortcutsOptions,
) {
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };

  // Access the shortcuts from the store
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const suppression = usePreferencesStore((s) => s.shortcutSuppression);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { handlers, options } = latest.current;
      const id = resolveShortcut(e, {
        shortcuts: SHORTCUTS,
        user: userShortcuts,
        isDisabled: options?.isDisabled,
        hasHandler: (candidate) => handlers[candidate] !== undefined,
      });
      if (id === null) return;
      const inTerminal = isTerminalSurfaceTarget(e.target);
      const altScreen = inTerminal ? focusedLeafAlternateScreen() : null;
      if (shouldSuppressShortcut(suppression, inTerminal, altScreen)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      handlers[id]?.(e);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [userShortcuts, suppression]);
}

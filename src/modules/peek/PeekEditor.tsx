import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import {
  EditorPane,
  type EditorPaneHandle,
} from "@/modules/editor/EditorPane";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { usePeekStore, type PeekTab } from "./lib/peekStore";

type Props = {
  tab: PeekTab;
  visible: boolean;
  onConfirmClose: (id: string) => void;
};

/**
 * Wraps EditorPane for a peek tab: fs-watch / external-write reload, watch-set
 * maintenance, and an Esc handler that yields to CodeMirror completions
 * (defaultPrevented) and closes the tab otherwise. Mod+s save ships inside
 * EditorPane's keymap.
 */
export const PeekEditor = forwardRef<EditorPaneHandle, Props>(
  function PeekEditor({ tab, visible, onConfirmClose }, ref) {
    const path = tab.path;
    const localRef = useRef<EditorPaneHandle | null>(null);
    const combinedRef = useCallback(
      (h: EditorPaneHandle | null) => {
        localRef.current = h;
        if (typeof ref === "function") ref(h);
        else if (ref)
          (ref as RefObject<EditorPaneHandle | null>).current = h;
      },
      [ref],
    );

    const setDirty = usePeekStore((s) => s.setDirty);
    const handleDirty = useCallback(
      (dirty: boolean) => setDirty(tab.id, dirty),
      [setDirty, tab.id],
    );

    // fs-watch reload for this file, mirroring useEditorFileSync. Diff tabs
    // render a snapshot of a git revision, so a disk change cannot affect them.
    useEffect(() => {
      if (tab.diff) return;
      const dir = parentDir(path);
      watchAdd([dir], [path]);
      let alive = true;
      let unlisten: (() => void) | undefined;
      void listenFsChanged((paths) => {
        const changed = new Set(paths.map((p) => p.replace(/\\/g, "/")));
        if (
          changed.has(path.replace(/\\/g, "/")) ||
          changed.has(dir.replace(/\\/g, "/"))
        ) {
          localRef.current?.reload();
        }
      }).then((un) => {
        if (alive) unlisten = un;
        else un();
      });
      return () => {
        alive = false;
        unlisten?.();
        watchRemove([dir], [path]);
      };
    }, [path, tab.diff]);

    // Reload on external writes (other windows/tools); "editor" source is
    // already handled in-memory by useDocument.
    useEffect(() => {
      if (tab.diff) return;
      let alive = true;
      let unlisten: (() => void) | undefined;
      const normalized = path.replace(/\\/g, "/");
      void getCurrentWebviewWindow()
        .listen<{ path: string; source?: string }>(
          "fs:file-written",
          (event) => {
            if (event.payload.source === "editor") return;
            if (event.payload.path.replace(/\\/g, "/") === normalized) {
              localRef.current?.reload();
            }
          },
        )
        .then((un) => {
          if (alive) unlisten = un;
          else un();
        });
      return () => {
        alive = false;
        unlisten?.();
      };
    }, [path, tab.diff]);

    const requestClose = useCallback(() => {
      onConfirmClose(tab.id);
    }, [onConfirmClose, tab.id]);

    const containerRef = useRef<HTMLDivElement | null>(null);

    // Esc closes the peek tab, but only from inside the card: the listener
    // sits on the container in the bubble phase so CodeMirror's keymap (and
    // any popup layered above it) handles Esc first; a defaultPrevented event
    // means something else consumed it (completion, vim mode, search panel).
    useEffect(() => {
      if (!visible) return;
      const el = containerRef.current;
      if (!el) return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        requestClose();
      };
      el.addEventListener("keydown", onKeyDown);
      return () => el.removeEventListener("keydown", onKeyDown);
    }, [visible, requestClose]);

    return (
      <div
        ref={containerRef}
        className={visible ? "h-full w-full" : "hidden"}
        aria-hidden={!visible}
      >
        {tab.diff ? (
          <GitDiffPane source={tab.diff} active={visible} />
        ) : (
          <EditorPane
            ref={combinedRef}
            path={path}
            onDirtyChange={handleDirty}
            onClose={requestClose}
            mediaActive={visible}
          />
        )}
      </div>
    );
  },
);

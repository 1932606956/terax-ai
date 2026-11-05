import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t as tr } from "@/i18n/zh";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/modules/explorer/FileIcon";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import {
  Cancel01Icon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePeekStore } from "./lib/peekStore";
import { PeekEditor } from "./PeekEditor";

const MIN_WIDTH_PCT = 20;
const MAX_WIDTH_PCT = 75;
const DEFAULT_WIDTH_PCT = 46;

/**
 * Row-relative card width in percent. The card is anchored to the row's left
 * edge, so dragging the right handle right grows it: width = pointer - left.
 */
export function dragWidthPct(clientX: number, left: number, width: number) {
  if (width <= 0) return null;
  const pct = ((clientX - left) / width) * 100;
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, pct));
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? path : path.slice(i + 1);
}

type Props = {
  activeSpaceId: string | null;
};

/**
 * Peek card area: a sibling overlay of WorkspaceSurface with its own mini
 * tab strip and editors. Never promotes files into the top tab bar.
 */
export function PeekTabs({ activeSpaceId }: Props) {
  const tabs = usePeekStore((s) => s.tabs);
  const activeId = usePeekStore((s) => s.activeId);
  const storeActiveSpaceId = usePeekStore((s) => s.activeSpaceId);
  const setActive = usePeekStore((s) => s.setActive);
  const close = usePeekStore((s) => s.close);
  const forceClose = usePeekStore((s) => s.forceClose);
  const clear = usePeekStore((s) => s.clear);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widthPct, setWidthPct] = useState(DEFAULT_WIDTH_PCT);
  // Expanded over the whole workspace row; drag-resize pauses while maximized.
  const [maximized, setMaximized] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmOthersId, setConfirmOthersId] = useState<string | null>(null);
  const draggingRef = useRef(false);

  // A peek area left over from a previous space must not linger over the
  useEffect(() => {
    if (storeActiveSpaceId != null && storeActiveSpaceId !== activeSpaceId) {
      clear();
    }
  }, [storeActiveSpaceId, activeSpaceId, clear]);

  // Right-edge drag handle: window-level tracking. The percentage is of the
  // workspace row, so the terminal beside the card keeps the remaining width
  // rather than being overlapped. The card grows when the pointer moves right
  // (it is anchored to the row's left edge).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      // A pointercancel (touch interaction) can end the gesture without
      // pointerup; guard against a stuck drag with a buttons check.
      if (e.buttons === 0) {
        draggingRef.current = false;
        return;
      }
      const row = containerRef.current?.parentElement;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const pct = dragWidthPct(e.clientX, rect.left, rect.width);
      if (pct !== null) setWidthPct(pct);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const requestClose = useCallback(
    (id: string) => {
      if (!close(id)) setConfirmId(id);
    },
    [close],
  );
  const requestCloseAll = useCallback(() => {
    if (!usePeekStore.getState().closeAll()) setConfirmAll(true);
  }, []);

  const requestCloseOthers = useCallback((id: string) => {
    if (!usePeekStore.getState().closeOthers(id)) setConfirmOthersId(id);
  }, []);

  const confirmTab = usePeekStore((s) =>
    s.tabs.find((t) => t.id === confirmId),
  );

  // Hidden when empty; the store collapses once the last tab closes.
  if (tabs.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full shrink-0 flex-col border-r bg-card"
      style={{ width: maximized ? "100%" : `${widthPct}%` }}
    >
      <div className="flex h-8 shrink-0 items-stretch gap-0.5 border-b px-1">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActive(tab.id)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        requestClose(tab.id);
                      }
                    }}
                    className={cn(
                      "group/tab relative flex shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs",
                      "text-muted-foreground hover:bg-accent hover:text-foreground",
                      active && "bg-accent text-foreground",
                    )}
                    title={tab.path}
                  >
                    <FileIcon
                      name={basename(tab.path)}
                      className="size-3.5 shrink-0 object-contain"
                    />
                    <span className="max-w-40 truncate">
                      {basename(tab.path)}
                    </span>
                    {tab.dirty && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-foreground"
                        aria-label="unsaved"
                      />
                    )}
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label="close"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestClose(tab.id);
                      }}
                      className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-foreground/10"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={10}
                        strokeWidth={2}
                      />
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className={COMPACT_CONTENT}>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => requestCloseOthers(tab.id)}
                  >
                    {tr("peek.closeOthers")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={requestCloseAll}
                  >
                    {tr("peek.closeAll")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-center pr-0.5">
          <button
            type="button"
            onClick={requestCloseAll}
            aria-label={tr("peek.closeAll")}
            title={tr("peek.closeAll")}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-label={maximized ? tr("peek.restore") : tr("peek.fullscreen")}
            title={maximized ? tr("peek.restore") : tr("peek.fullscreen")}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon
              icon={maximized ? SidebarLeftIcon : SidebarLeft01Icon}
              size={12}
              strokeWidth={1.9}
            />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <PeekEditor
            key={tab.id}
            tab={tab}
            visible={tab.id === activeId}
            onConfirmClose={requestClose}
          />
        ))}
      </div>

      {/* Right-edge drag handle (4px); hidden while maximized */}
      {maximized ? null : (
        <div
          onPointerDown={() => {
            draggingRef.current = true;
          }}
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-border"
        />
      )}

      <AlertDialog
        open={confirmId !== null || confirmAll || confirmOthersId !== null}
        onOpenChange={(openState) => {
          if (!openState) {
            setConfirmId(null);
            setConfirmAll(false);
            setConfirmOthersId(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("peek.dirtyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAll || confirmOthersId !== null
                ? tr("peek.dirtyBodyAll")
                : tr(
                    "peek.dirtyBody",
                    confirmTab ? basename(confirmTab.path) : "",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAll) clear();
                else if (confirmOthersId != null) {
                  // Confirmed: drop every tab except the kept one.
                  usePeekStore.setState((s) => ({
                    tabs: s.tabs.filter((t) => t.id === confirmOthersId),
                    activeId: confirmOthersId,
                  }));
                } else if (confirmId != null) forceClose(confirmId);
                setConfirmId(null);
                setConfirmAll(false);
                setConfirmOthersId(null);
              }}
            >
              {tr("peek.dirtyConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

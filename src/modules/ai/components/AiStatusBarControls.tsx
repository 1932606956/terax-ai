import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n/zh";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ProviderIcon } from "@/settings/components/ProviderIcon";
import {
  Add01Icon,
  AiBookIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Clock01Icon,
  FavouriteIcon,
  Search01Icon,
  SparklesIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useRef, useState } from "react";
import { compatModelIdForEndpoint, getCompatModelInfo } from "../config";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { useChatStore } from "../store/chatStore";

type Tab = "all" | "favorites" | "recent";

/** Status-bar model picker + explicit panel collapse control. */
export function AiStatusBarControls() {
  const closePanel = useChatStore((s) => s.closePanel);
  return (
    <div className="flex items-center gap-0.5">
      <ModelDropdown />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={closePanel}
        aria-label={t("ai.collapse")}
        title={t("ai.collapse")}
        className="my-1 h-5.5 w-5.5 rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowUp01Icon} size={12} strokeWidth={1.75} />
      </Button>
    </div>
  );
}

/** Opens the AI panel when it is closed. */
export function AiOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onOpen}
      className="my-1 h-5.5 gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={1.75} />
      {t("ai.open")}
    </Button>
  );
}

function ModelDropdown() {
  const selected = useChatStore((s) => s.selectedModelId);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const endpointModels = useMemo(
    () =>
      customEndpoints.map((ep) =>
        getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
      ),
    [customEndpoints],
  );

  const current = useMemo(
    () =>
      endpointModels.find((m) => m.id === selected) ??
      endpointModels[0] ??
      null,
    [endpointModels, selected],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool = endpointModels;
    if (tab === "favorites") {
      pool = pool.filter((m) => favoriteIds.includes(m.id));
    } else if (tab === "recent") {
      pool = pool.filter((m) => recentIds.includes(m.id));
    }
    if (!q) return pool;
    return pool.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.hint.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    );
  }, [endpointModels, favoriteIds, recentIds, search, tab]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "my-1 h-5.5 gap-1 rounded-md px-1.5 text-xs hover:bg-accent hover:text-foreground",
            current
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
          title={current ? `Model: ${current.label}` : t("ai.noEndpoint")}
        >
          {current ? current.label : t("ai.noEndpoint")}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[28rem] overflow-hidden rounded-xl border border-border/70 p-0 shadow-xl"
        onFocusCapture={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground"
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ai.searchModels")}
            className="h-6 w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        <div className="flex items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
          <TabButton
            label={t("ai.tabAll")}
            icon={AiBookIcon}
            active={tab === "all"}
            count={endpointModels.length}
            onClick={() => setTab("all")}
          />
          <TabButton
            label={t("ai.tabFavorites")}
            icon={FavouriteIcon}
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
          />
          <TabButton
            label={t("ai.tabRecent")}
            icon={Clock01Icon}
            active={tab === "recent"}
            onClick={() => setTab("recent")}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => void openSettingsWindow("models")}
          >
            <HugeiconsIcon icon={Add01Icon} size={11} strokeWidth={2} />
            {t("ai.addEndpoint")}
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
              {endpointModels.length === 0
                ? t("ai.noEndpointHint")
                : t("ai.noMatches")}
            </div>
          ) : (
            filtered.map((m) => (
              <DropdownMenuItem
                key={m.id}
                className={cn(
                  "flex items-start gap-2 text-[12px]",
                  m.id === selected && "bg-accent/60",
                )}
                onSelect={() => setSelected(m.id)}
              >
                <ProviderIcon provider={m.provider} size={12} />
                <span className="flex flex-1 flex-col">
                  <span>{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {m.description}
                  </span>
                </span>
                {m.id === selected ? (
                  <HugeiconsIcon
                    icon={Tick01Icon}
                    size={11}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-primary"
                  />
                ) : (
                  <button
                    type="button"
                    title={t("ai.favorite")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void toggleFavoriteModel(m.id);
                    }}
                    className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                  >
                    <HugeiconsIcon
                      icon={FavouriteIcon}
                      size={11}
                      strokeWidth={1.75}
                    />
                  </button>
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: typeof AiBookIcon;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
      {label}
      {count === undefined ? null : (
        <span className="text-[10px] text-muted-foreground/70">{count}</span>
      )}
    </button>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n/zh";
import { cn } from "@/lib/utils";
import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  getCompatModelInfo,
} from "@/modules/ai/config";
import {
  type CustomEndpointKeys,
  clearCustomEndpointKey,
  getAllCustomEndpointKeys,
  setCustomEndpointKey,
} from "@/modules/ai/lib/keyring";
import {
  fetchEndpointModels,
  type RemoteModel,
} from "@/modules/ai/lib/modelList";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setCustomEndpoints,
  setDefaultModel,
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ChevronDown,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { SectionHeader } from "../components/SectionHeader";

/**
 * Models settings: there is no built-in catalog. Every model comes from a
 * user-defined OpenAI-compatible endpoint.
 */
export function ModelsSection() {
  const [epKeys, setEpKeys] = useState<CustomEndpointKeys>({});
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);

  useEffect(() => {
    void getAllCustomEndpointKeys(customEndpoints).then(setEpKeys);
  }, [customEndpoints]);

  const onSaveEndpointKey = async (endpointId: string, value: string) => {
    await setCustomEndpointKey(endpointId, value);
    setEpKeys((prev) => ({ ...prev, [endpointId]: value }));
    await emitKeysChanged();
  };

  const onClearEndpointKey = async (endpointId: string) => {
    await clearCustomEndpointKey(endpointId);
    setEpKeys((prev) => ({ ...prev, [endpointId]: null }));
    await emitKeysChanged();
  };

  const addCustomEndpoint = async () => {
    const ep: CustomEndpoint = {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      baseURL: "",
      modelId: "",
      contextLimit: 128_000,
    };
    await setCustomEndpoints([...customEndpoints, ep]);
  };

  const updateCustomEndpoint = async (
    id: string,
    patch: Partial<CustomEndpoint>,
  ) => {
    await setCustomEndpoints(
      customEndpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const removeCustomEndpoint = async (id: string) => {
    await clearCustomEndpointKey(id);
    setEpKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const deadModelId = compatModelIdForEndpoint(id);
    const { favoriteModelIds, recentModelIds } = usePreferencesStore.getState();
    if (favoriteModelIds.includes(deadModelId)) {
      await setFavoriteModelIds(
        favoriteModelIds.filter((m) => m !== deadModelId),
      );
    }
    if (recentModelIds.includes(deadModelId)) {
      await setRecentModelIds(recentModelIds.filter((m) => m !== deadModelId));
    }

    const remaining = customEndpoints.filter((e) => e.id !== id);
    const { selectedModelId, setSelectedModelId } = useChatStore.getState();
    if (selectedModelId === deadModelId) {
      setSelectedModelId(
        remaining[0] ? compatModelIdForEndpoint(remaining[0].id) : "",
      );
    }
    if (defaultModel === deadModelId) {
      await setDefaultModel(
        remaining[0] ? compatModelIdForEndpoint(remaining[0].id) : "",
      );
    }

    await setCustomEndpoints(remaining);
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title={t("models.title")}
        description={t("models.description")}
      />

      <DefaultsBlock
        defaultModel={defaultModel}
        customEndpoints={customEndpoints}
        onAdd={addCustomEndpoint}
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>{t("models.endpoints")}</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void addCustomEndpoint()}
            className="h-7 gap-1.5 px-2.5 text-[11px]"
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            {t("models.addEndpoint")}
          </Button>
        </div>

        {customEndpoints.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              {t("models.empty")}
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              {t("models.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {customEndpoints.map((ep) => (
              <CustomEndpointCard
                key={ep.id}
                endpoint={ep}
                endpointKey={epKeys[ep.id] ?? null}
                onSaveKey={(v) => onSaveEndpointKey(ep.id, v)}
                onClearKey={() => onClearEndpointKey(ep.id)}
                onUpdate={(patch) => updateCustomEndpoint(ep.id, patch)}
                onRemove={() => void removeCustomEndpoint(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DefaultsBlock({
  defaultModel,
  customEndpoints,
  onAdd,
}: {
  defaultModel: string;
  customEndpoints: readonly CustomEndpoint[];
  onAdd: () => Promise<void>;
}) {
  const configured = customEndpoints.filter(
    (e) => e.baseURL.trim() && e.modelId.trim(),
  );
  const current = defaultModel
    ? getCompatModelInfo(defaultModel, customEndpoints)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <Label>{t("models.defaultModel")}</Label>
      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label={t("models.chatModel")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={configured.length === 0}
                className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
              >
                <span className="flex items-center gap-2 truncate">
                  <ProviderIcon provider="openai-compatible" size={13} />
                  <span className="truncate">
                    {current ? current.label : t("models.noModel")}
                  </span>
                  {current ? (
                    <span className="text-muted-foreground">
                      · {current.hint}
                    </span>
                  ) : null}
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={11}
                  strokeWidth={2}
                  className="opacity-70"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-70 p-1">
              {configured.map((ep) => {
                const id = compatModelIdForEndpoint(ep.id);
                return (
                  <DropdownMenuItem
                    key={ep.id}
                    onSelect={() => void setDefaultModel(id)}
                    className={cn(
                      "flex items-start gap-2 text-[12px]",
                      id === defaultModel && "bg-accent/50",
                    )}
                  >
                    <span className="flex flex-1 flex-col">
                      <span>{ep.modelId}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {ep.name || ep.baseURL}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>

        {configured.length === 0 ? (
          <p className="pl-19 text-[10.5px] text-muted-foreground">
            {t("models.noModelHint")}{" "}
            <button
              type="button"
              onClick={() => void onAdd()}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("models.addEndpoint")}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CustomEndpointCard({
  endpoint,
  endpointKey,
  onSaveKey,
  onClearKey,
  onUpdate,
  onRemove,
}: {
  endpoint: CustomEndpoint;
  endpointKey: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  onUpdate: (patch: Partial<CustomEndpoint>) => Promise<void>;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!endpoint.baseURL.trim());
  const [nameDraft, setNameDraft] = useState(endpoint.name);
  const [urlDraft, setUrlDraft] = useState(endpoint.baseURL);
  const [modelDraft, setModelDraft] = useState(endpoint.modelId);
  const [contextDraft, setContextDraft] = useState(
    String(endpoint.contextLimit ?? ""),
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [modelsState, setModelsState] = useState<{
    status: "idle" | "loading" | "ok" | "error";
    models: RemoteModel[];
  }>({ status: "idle", models: [] });
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setNameDraft(endpoint.name), [endpoint.name]);
  useEffect(() => setUrlDraft(endpoint.baseURL), [endpoint.baseURL]);
  useEffect(() => setModelDraft(endpoint.modelId), [endpoint.modelId]);
  useEffect(
    () => setContextDraft(String(endpoint.contextLimit ?? "")),
    [endpoint.contextLimit],
  );

  const configured = !!endpoint.baseURL.trim() && !!endpoint.modelId.trim();

  const test = async () => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: urlDraft });
      setTestStatus(status > 0 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  const loadModels = async () => {
    if (!urlDraft.trim()) return;
    setModelsState({ status: "loading", models: [] });
    try {
      const models = await fetchEndpointModels(urlDraft, endpoint.id);
      setModelsState({ status: "ok", models });
    } catch {
      setModelsState({ status: "error", models: [] });
    }
  };

  return (
    <div className="flex flex-col rounded-lg border border-border/60 bg-card/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        <HugeiconsIcon
          icon={ChevronDown}
          size={12}
          strokeWidth={2}
          className={cn(
            "shrink-0 text-muted-foreground/60 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <ProviderIcon provider="openai-compatible" size={15} />
        <span className="text-[12.5px] font-medium truncate">
          {endpoint.name || "OpenAI Compatible"}
        </span>
        {endpoint.modelId.trim() && (
          <span className="text-[10.5px] text-muted-foreground truncate font-mono">
            {endpoint.modelId}
          </span>
        )}
        {configured ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Connected
          </Badge>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t("models.removeEndpoint")}
          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          <FieldRow label="Name">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const v = nameDraft.trim();
                if (v !== endpoint.name) void onUpdate({ name: v });
              }}
              placeholder={t("models.namePlaceholder")}
              spellCheck={false}
              className="h-8 flex-1 text-[11.5px]"
            />
          </FieldRow>

          <FieldRow label="Base URL">
            <div className="flex flex-1 gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v !== endpoint.baseURL) void onUpdate({ baseURL: v });
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void test()}
                disabled={!urlDraft.trim()}
                className="h-8 px-3 text-[11px]"
              >
                Test
              </Button>
            </div>
          </FieldRow>

          <FieldRow label="Model ID">
            <div className="flex flex-1 gap-1.5">
              <Input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={() => {
                  const v = modelDraft.trim();
                  if (v !== endpoint.modelId) void onUpdate({ modelId: v });
                }}
                placeholder="gpt-4o, qwen3-max, glm-4.6, …"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadModels()}
                    disabled={!urlDraft.trim()}
                    className="h-8 gap-1 px-3 text-[11px]"
                  >
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={12}
                      strokeWidth={2}
                    />
                    {t("models.fetch")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-72 min-w-60 overflow-y-auto p-1"
                >
                  {modelsState.status === "loading" && (
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      {t("models.fetching")}
                    </div>
                  )}
                  {modelsState.status === "error" && (
                    <div className="px-2 py-1.5 text-[11px] text-destructive">
                      {t("models.fetchFailed")}
                    </div>
                  )}
                  {modelsState.status === "ok" &&
                    modelsState.models.length === 0 && (
                      <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {t("models.fetchEmpty")}
                      </div>
                    )}
                  {modelsState.status === "ok" &&
                    modelsState.models.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          setModelDraft(m.id);
                          const patch: Partial<CustomEndpoint> = {
                            modelId: m.id,
                          };
                          if (m.contextLimit && m.contextLimit >= 1000) {
                            patch.contextLimit = m.contextLimit;
                            setContextDraft(String(m.contextLimit));
                          }
                          void onUpdate(patch);
                        }}
                        className="font-mono text-[11px]"
                      >
                        {m.id}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </FieldRow>

          <FieldRow label="Context">
            <div className="flex flex-1 items-center gap-1.5">
              <Input
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                onBlur={() => {
                  const v = parseInt(contextDraft, 10);
                  if (Number.isFinite(v) && v >= 1000)
                    void onUpdate({ contextLimit: v });
                  else setContextDraft(String(endpoint.contextLimit ?? ""));
                }}
                placeholder="128000"
                spellCheck={false}
                className="h-8 w-28 font-mono text-[11.5px]"
              />
              <span className="text-[10.5px] text-muted-foreground">
                tokens
              </span>
            </div>
          </FieldRow>

          <FieldRow label="API key">
            {endpointKey ? (
              <div className="flex flex-1 items-center gap-1.5">
                <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {`${endpointKey.slice(0, 4)}${"•".repeat(8)}${endpointKey.slice(-4)}`}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void onClearKey()}
                  title={t("models.removeKey")}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
            ) : (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={t("models.keyPlaceholder")}
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    const v = keyDraft.trim();
                    if (!v) return;
                    await onSaveKey(v);
                    setKeyDraft("");
                  }}
                  disabled={!keyDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  Save
                </Button>
              </div>
            )}
          </FieldRow>

          <StatusLine status={testStatus} />
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}

function StatusLine({
  status,
}: {
  status: "idle" | "testing" | "ok" | "fail";
}) {
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <span className="text-[10.5px] text-muted-foreground">Testing…</span>
    );
  }
  if (status === "ok") {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        Reachable — server responded.
      </span>
    );
  }
  return (
    <span className="text-[10.5px] text-destructive/80">
      Could not reach the server.
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

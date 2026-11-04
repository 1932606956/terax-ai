import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n/zh";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import {
  type AgentInstanceCount,
  type AgentLauncher,
  type AgentLaunchRequest,
  DEFAULT_AGENT_INSTANCES,
  defaultAgentLabel,
  newCustomAgentId,
  validateAgentLaunchCommand,
} from "@/modules/agents/lib/launcher";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAgentLaunchers } from "@/modules/settings/store";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  PlayIcon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  onBack: () => void;
  onLaunch: (request: AgentLaunchRequest) => void;
};

const INSTANCE_COUNTS: AgentInstanceCount[] = [1, 2, 3, 4];

export function AgentLauncherPanel({ onBack, onLaunch }: Props) {
  const storedLaunchers = usePreferencesStore((s) => s.agentLaunchers);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const [agentId, setAgentId] = useState(() => storedLaunchers[0]?.id ?? "");
  const [instances, setInstances] = useState<AgentInstanceCount>(
    DEFAULT_AGENT_INSTANCES,
  );
  const [drafts, setDrafts] = useState<AgentLauncher[]>(storedLaunchers);
  const [commandDraft, setCommandDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const hydratedRef = useRef(hydrated);
  const persistedRef = useRef(storedLaunchers);

  const selected = drafts.find((a) => a.id === agentId) ?? drafts[0];
  const command = commandDraft;
  const validation = validateAgentLaunchCommand(command);
  const addCommandValidation = validateAgentLaunchCommand(addCommand);

  useEffect(() => {
    if (!hydrated || hydratedRef.current) return;
    hydratedRef.current = true;
    persistedRef.current = storedLaunchers;
    setDrafts(storedLaunchers);
    setAgentId((id) =>
      storedLaunchers.some((a) => a.id === id)
        ? id
        : (storedLaunchers[0]?.id ?? ""),
    );
  }, [hydrated, storedLaunchers]);

  // Keep the command field in sync with whichever entry is selected.
  useEffect(() => {
    setCommandDraft(selected?.command ?? "");
  }, [selected?.id, selected?.command]);

  const save = (next: AgentLauncher[]) => {
    persistedRef.current = next;
    setDrafts(next);
    void setAgentLaunchers(next).catch((error) => {
      console.error("[terax] failed to save agents:", error);
    });
  };

  const commitCommand = () => {
    if (!selected) return;
    const result = validateAgentLaunchCommand(command);
    if (!result.ok) {
      setCommandDraft(selected.command);
      return;
    }
    if (result.command === selected.command) return;
    save(
      drafts.map((a) =>
        a.id === selected.id ? { ...a, command: result.command } : a,
      ),
    );
  };

  const resetCommand = () => {
    if (!selected) return;
    const fallback = defaultAgentLabel(selected.command) || selected.command;
    setCommandDraft(fallback);
    save(
      drafts.map((a) =>
        a.id === selected.id ? { ...a, command: fallback } : a,
      ),
    );
  };

  const addAgent = () => {
    const result = validateAgentLaunchCommand(addCommand);
    if (!result.ok) return;
    const label = addName.trim() || defaultAgentLabel(result.command);
    if (!label) return;
    const entry: AgentLauncher = {
      id: newCustomAgentId(),
      label,
      command: result.command,
      supportsHooks: false,
      builtIn: false,
    };
    save([...drafts, entry]);
    setAgentId(entry.id);
    setAdding(false);
    setAddName("");
    setAddCommand("");
  };

  const removeAgent = (id: string) => {
    const target = drafts.find((a) => a.id === id);
    // Built-ins stay: they are the defaults a fresh install falls back to.
    if (!target || target.builtIn || drafts.length <= 1) return;
    const next = drafts.filter((a) => a.id !== id);
    save(next);
    if (agentId === id) setAgentId(next[0]?.id ?? "");
  };

  const submit = () => {
    if (!selected) return;
    const result = validateAgentLaunchCommand(command);
    if (!result.ok) return;
    if (result.command !== selected.command) commitCommand();
    onLaunch({
      agent: selected.id,
      label: selected.label,
      command: result.command,
      supportsHooks: selected.supportsHooks,
      instances,
    });
  };

  return (
    <form
      className="animate-in fade-in-0 slide-in-from-right-2 duration-150"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex h-9 items-center gap-2 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-md text-muted-foreground"
          onClick={onBack}
          aria-label={t("ag.backToNewTab")}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </Button>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">
            {t("ag.launchTitle")}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t("ag.launchSubtitle")}
          </div>
        </div>
      </div>

      <div className="mt-1 flex flex-col gap-1 border-t border-border/60 pt-1.5">
        {drafts.map((agent) => {
          const isSelected = agent.id === selected?.id;
          return (
            <div key={agent.id} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hydrated}
                aria-pressed={isSelected}
                onClick={() => {
                  commitCommand();
                  setAgentId(agent.id);
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                  isSelected
                    ? "border-primary/35 bg-primary/10 text-foreground"
                    : "border-transparent bg-foreground/[0.035] text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <AgentIcon
                  agent={agent.id}
                  size={16}
                  className={cn(
                    "shrink-0",
                    isSelected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {agent.label}
                </span>
                <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground/70">
                  {agent.command}
                </span>
              </button>
              {agent.builtIn ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 rounded-md text-muted-foreground hover:text-destructive"
                  onClick={() => removeAgent(agent.id)}
                  title={t("ag.removeAgent")}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-border/60 p-2">
          <Input
            value={addName}
            spellCheck={false}
            onChange={(e) => setAddName(e.target.value)}
            placeholder={t("ag.agentNamePlaceholder")}
            className="h-8 rounded-lg bg-input/40 px-2.5 text-xs"
          />
          <Input
            value={addCommand}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={!addCommandValidation.ok}
            onChange={(e) => setAddCommand(e.target.value)}
            placeholder={t("ag.agentCommandPlaceholder")}
            className="h-8 rounded-lg bg-input/40 px-2.5 font-mono text-xs"
          />
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 rounded-lg text-[11px]"
              disabled={!addCommandValidation.ok}
              onClick={addAgent}
            >
              {t("ag.addAgentConfirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg text-[11px]"
              onClick={() => {
                setAdding(false);
                setAddName("");
                setAddCommand("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
          {t("ag.addAgent")}
        </button>
      )}

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          {t("ag.instances")}
        </legend>
        <div className="grid grid-cols-4 gap-1">
          {INSTANCE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              disabled={!hydrated}
              aria-label={t("ag.instanceCount", String(count))}
              aria-pressed={instances === count}
              onClick={() => setInstances(count)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                instances === count
                  ? "border-primary/35 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/30 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <PaneGlyph count={count} />
              {count}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center">
          <label
            htmlFor="agent-start-command"
            className="text-[11px] font-medium text-muted-foreground"
          >
            {t("ag.startCommand")}
          </label>
          <button
            type="button"
            onClick={resetCommand}
            disabled={!hydrated || !selected}
            className="ml-auto flex items-center gap-1 rounded-md px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title={t("ag.reset")}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.75} />
            {t("ag.reset")}
          </button>
        </div>
        <Input
          id="agent-start-command"
          disabled={!hydrated || !selected}
          value={command}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!validation.ok}
          onChange={(event) => setCommandDraft(event.target.value)}
          onBlur={commitCommand}
          className="h-8 rounded-xl bg-input/40 px-2.5 font-mono text-xs"
          placeholder={selected?.command ?? ""}
        />
        <div
          className={cn(
            "mt-1 min-h-4 text-[10px]",
            validation.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {validation.ok ? t("ag.aliasesHint") : validation.error}
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        className="mt-1 w-full rounded-xl"
        disabled={!hydrated || !selected || !validation.ok}
      >
        <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
        {t("ag.launchAgents", String(instances))}
      </Button>
    </form>
  );
}

function PaneGlyph({ count }: { count: AgentInstanceCount }) {
  const cell = "rounded-[1px] bg-current opacity-75";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 gap-[2px]",
        count === 1 ? "grid-cols-1" : "grid-cols-2",
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn("size-[5px]", cell)} />
      ))}
    </span>
  );
}

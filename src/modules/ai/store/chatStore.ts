import { t } from "@/i18n/zh";
import type { Chat, UIMessage } from "@ai-sdk/react";
import { toast } from "sonner";
import { create } from "zustand";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModel,
  isCompatModelId,
  type ModelId,
  type ProviderId,
} from "../config";
import { useTodosStore } from "./todoStore";
import type { AgentUsage } from "../lib/agent";
import {
  EMPTY_PROVIDER_KEYS,
  type ProviderKeys,
  type CustomEndpointKeys,
} from "../lib/keyring";
import {
  deleteSessionData,
  deriveTitle,
  loadAll,
  loadMessages,
  newSessionId,
  saveActiveId,
  saveMessages,
  saveSessionsList,
  type SessionMeta,
} from "../lib/sessions";
import { pushRecentModel } from "../lib/modelPrefs";
import { persistDelay } from "../lib/persistSchedule";
import type { FileAttachment } from "../lib/composer";
import type { Snippet } from "../lib/snippets";
import type { SlashCommandMeta } from "../lib/slashCommands";

export type ScopeUIState = { panelOpen: boolean; miniOpen: boolean };

export type ScopeDraft = {
  value: string;
  files: FileAttachment[];
  pickedSnippets: Snippet[];
  pickedCommands: SlashCommandMeta[];
};

type ApprovalResponder = (approvalId: string, approved: boolean) => void;

export type Live = {
  getCwd: () => string | null;
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  injectIntoActivePty: (text: string) => boolean;
  getWorkspaceRoot: () => string | null;
  getActiveFile: () => string | null;
  openPreview: (url: string) => boolean;
  spawnManagedAgent: (
    prompt: string,
    sessionId: string,
  ) => { tabId: number; leafId: number } | null;
  readLeafBuffer: (leafId: number) => string | null;
};

export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "awaiting-approval"
  | "error";

export type AgentMeta = {
  status: AgentRunStatus;
  step: string | null;
  approvalsPending: number;
  error: string | null;
  tokens: AgentUsage;
  lastInputTokens: number;
  lastCachedTokens: number;
  hitStepCap: boolean;
  compactionNotice: { droppedCount: number; at: number } | null;
};

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

const IDLE_META: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: ZERO_USAGE,
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
};

type MiniState = {
  open: boolean;
};

type PendingSelection = {
  id: string;
  text: string;
  source: "terminal" | "editor";
};

type StoreState = {
  live: Live;
  setLive: (live: Live) => void;

  /**
   * Set by AgentRunBridge each render. Lets surfaces outside the chat hook
   * tree (e.g. the AI diff tab in the editor area) resolve a pending tool
   * approval through the active session's `addToolApprovalResponse`.
   */
  approvalResponder: ApprovalResponder | null;
  setApprovalResponder: (fn: ApprovalResponder | null) => void;
  respondToApproval: (approvalId: string, approved: boolean) => void;

  apiKeys: ProviderKeys;
  setApiKeys: (keys: ProviderKeys) => void;
  setApiKey: (provider: ProviderId, key: string | null) => void;

  customEndpointKeys: CustomEndpointKeys;
  setCustomEndpointKeys: (keys: CustomEndpointKeys) => void;

  selectedModelId: string;
  setSelectedModelId: (id: string) => void;

  mini: MiniState;
  openMini: () => void;
  closeMini: () => void;
  toggleMini: () => void;

  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  focusSignal: number;
  pendingPrefill: string | null;
  focusInput: (prefill?: string | null) => void;
  consumePrefill: () => string | null;

  pendingSelections: PendingSelection[];
  attachSelection: (text: string, source: "terminal" | "editor") => void;
  consumeSelections: () => PendingSelection[];

  agentMeta: AgentMeta;
  patchAgentMeta: (patch: Partial<AgentMeta>) => void;
  resetAgentMeta: () => void;

  // Chat scope isolation (one scope per top-level tab)
  activeScopeId: string | null;
  /** scopeId -> that scope's remembered active session id. */
  scopeSessions: Record<string, string>;
  /** scopeId -> panel/mini visibility remembered per scope. */
  scopeUI: Record<string, ScopeUIState>;
  /** scopeId -> composer draft remembered per scope. */
  scopeDrafts: Record<string, ScopeDraft>;
  /** Activates the scope of the active tab: swaps session/UI/draft state. */
  setActiveScope: (scopeId: string) => void;
  /** Merges a partial draft for a scope (composer saves on change). */
  patchDraft: (scopeId: string, patch: Partial<ScopeDraft>) => void;

  // Sessions
  sessionsHydrated: boolean;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  hydrateSessions: () => Promise<void>;
  newSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Persist messages of a session and bump its updatedAt + auto-title. */
  persistMessages: (id: string, messages: UIMessage[]) => void;
};

const NOOP_LIVE: Live = {
  getCwd: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  getWorkspaceRoot: () => null,
  getActiveFile: () => null,
  openPreview: () => false,
  spawnManagedAgent: () => null,
  readLeafBuffer: () => null,
};

const CHATS_LRU_CAP = 8;
export const chats = new Map<string, Chat<UIMessage>>();

export function touchChat(id: string, c: Chat<UIMessage>) {
  if (chats.has(id)) chats.delete(id);
  chats.set(id, c);
  while (chats.size > CHATS_LRU_CAP) {
    const oldest = chats.keys().next().value;
    if (!oldest || oldest === id) break;
    if (useChatStore.getState().activeSessionId === oldest) break;
    flushPersistEntry(oldest);
    void chats.get(oldest)?.stop();
    chats.delete(oldest);
  }
}
// Initial messages for a session, populated at hydration time and consumed
// when the matching Chat is constructed.
export const seedMessages = new Map<string, UIMessage[]>();

// Per-token message persistence is scheduled, not debounced per token: see
// `persistSchedule.ts`. Streaming saves are plain atomic replaces; the flush
// functions below (turn end, switch, eviction, close) are durable.
const pendingPersist = new Map<
  string,
  { latest: UIMessage[]; timer: ReturnType<typeof setTimeout>; firstAt: number }
>();
const lastPersistedAt = new Map<string, number>();

function commitPersist(id: string, durable: boolean) {
  const entry = pendingPersist.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingPersist.delete(id);
  lastPersistedAt.set(id, Date.now());
  void saveMessages(id, entry.latest, { durable });
}

function schedulePersist(id: string, messages: UIMessage[]) {
  const now = Date.now();
  const existing = pendingPersist.get(id);
  if (existing) clearTimeout(existing.timer);
  const firstAt = existing?.firstAt ?? now;
  const timer = setTimeout(
    () => commitPersist(id, false),
    persistDelay(now, firstAt, lastPersistedAt.get(id) ?? null),
  );
  pendingPersist.set(id, { latest: messages, timer, firstAt });
}

function flushPersistEntry(id: string) {
  commitPersist(id, true);
}

export function flushPersist(id?: string): void {
  if (id) {
    flushPersistEntry(id);
    return;
  }
  for (const key of Array.from(pendingPersist.keys())) flushPersistEntry(key);
}

/** Guards async scope loads: only the newest activation may commit. */
let scopeLoadGeneration = 0;

/**
 * Session choice for the active scope: adopt legacy scopeless rows, pick
 * the remembered (or most recent) session, and activate it only when its
 * messages are resident - a pending disk read parks the store instead.
 * Called from setActiveScope and once after hydrate (the scope may have
 * been set before the list loaded; the early return there would otherwise
 * skip this pass).
 */
function reconcileActiveScope(
  get: () => StoreState,
  set: (partial: Partial<StoreState>) => void,
  scopeId: string,
): void {
  const s = get();

  // Legacy sessions (pre-scope data) are adopted by the first scope the
  // user activates, keeping their ids and messages.
  let sessions = s.sessions;
  if (sessions.some((x) => x.scopeId === "")) {
    sessions = sessions.map((x) =>
      x.scopeId === "" ? { ...x, scopeId } : x,
    );
    void saveSessionsList(sessions);
  }

  const remembered = s.scopeSessions[scopeId];
  const inScope = sessions
    .filter((x) => x.scopeId === scopeId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const target = remembered
    ? sessions.find((x) => x.id === remembered)
    : inScope[0];

  if (!target) {
    // No session for this scope yet: create a fresh one bound to it.
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scopeId,
    };
    const nextSessions = [meta, ...sessions];
    set({
      sessions: nextSessions,
      activeSessionId: id,
      scopeSessions: { ...s.scopeSessions, [scopeId]: id },
    });
    void saveSessionsList(nextSessions);
    void saveActiveId(id);
    return;
  }

  const activate = () => {
    const cur = get();
    set({
      activeSessionId: target.id,
      scopeSessions: { ...cur.scopeSessions, [scopeId]: target.id },
    });
    void saveActiveId(target.id);
  };
  if (chats.has(target.id) || seedMessages.has(target.id)) {
    set({ sessions });
    activate();
    return;
  }
  // Park without an active session until the messages load: activating an
  // unread session would let a send overwrite its file with an empty Chat.
  set({ sessions, activeSessionId: null });
  const generation = ++scopeLoadGeneration;
  void loadMessages(target.id)
    .then((m) => {
      // Only the newest activation may commit.
      if (generation !== scopeLoadGeneration) return;
      if (get().activeScopeId !== scopeId) return;
      if (m && m.length > 0 && !chats.has(target.id)) {
        seedMessages.set(target.id, m);
      }
      activate();
    })
    .catch((error: unknown) => {
      // Stay parked (switching sessions or re-entering retries): opening
      // it empty could overwrite a healthy, momentarily unreadable file.
      toast.error(t("toast.openConvFailed"), {
        id: `conversation-open:${target.id}`,
        description: String(error),
      });
    });
}
export const useChatStore = create<StoreState>((set, get) => ({
  live: NOOP_LIVE,
  setLive: (live) => set({ live }),

  approvalResponder: null,
  setApprovalResponder: (fn) => set({ approvalResponder: fn }),
  respondToApproval: (approvalId, approved) => {
    const fn = get().approvalResponder;
    if (fn) fn(approvalId, approved);
  },

  apiKeys: { ...EMPTY_PROVIDER_KEYS },
  setApiKeys: (keys) => set({ apiKeys: keys }),
  setApiKey: (provider, key) => {
    set({ apiKeys: { ...get().apiKeys, [provider]: key } });
  },

  customEndpointKeys: {},
  setCustomEndpointKeys: (keys) => set({ customEndpointKeys: keys }),

  selectedModelId: DEFAULT_MODEL_ID,
  setSelectedModelId: (id) => {
    set({ selectedModelId: id });
    void pushRecentModel(id);
  },

  mini: { open: false },
  openMini: () => set({ mini: { open: true } }),
  closeMini: () => set({ mini: { open: false } }),
  toggleMini: () => set((s) => ({ mini: { open: !s.mini.open } })),

  panelOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  focusSignal: 0,
  pendingPrefill: null,
  focusInput: (prefill = null) =>
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingPrefill: prefill ?? null,
    })),
  consumePrefill: () => {
    const v = get().pendingPrefill;
    if (v != null) set({ pendingPrefill: null });
    return v;
  },

  pendingSelections: [],
  attachSelection: (text, source) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingSelections: [
        ...s.pendingSelections,
        { id, text: trimmed, source },
      ],
    }));
  },
  consumeSelections: () => {
    const v = get().pendingSelections;
    if (v.length > 0) set({ pendingSelections: [] });
    return v;
  },

  agentMeta: IDLE_META,
  patchAgentMeta: (patch) =>
    set((s) => ({ agentMeta: { ...s.agentMeta, ...patch } })),
  resetAgentMeta: () => set({ agentMeta: IDLE_META }),

  activeScopeId: null,
  scopeSessions: {},
  scopeUI: {},
  scopeDrafts: {},
  setActiveScope: (nextScopeId) => {
    const s = get();
    if (s.activeScopeId === nextScopeId) return;

    // A running generation would keep executing tools against the live
    // bridge, which reads the newly active tab's context: stop it rather
    // than let one project's run act on another's terminal. A run parked on
    // an approval card is safe to leave: it does nothing until answered.
    const running =
      s.agentMeta.status === "thinking" ||
      s.agentMeta.status === "streaming";
    if (running && s.activeSessionId) {
      void chats.get(s.activeSessionId)?.stop();
    }

    // Remember the outgoing scope's panel/mini visibility so coming back
    // restores what the user had, not the incoming scope's state.
    const scopeUI = s.activeScopeId
      ? {
          ...s.scopeUI,
          [s.activeScopeId]: {
            panelOpen: s.panelOpen,
            miniOpen: s.mini.open,
          },
        }
      : s.scopeUI;
    const ui = scopeUI[nextScopeId] ?? { panelOpen: false, miniOpen: false };

    // Scope chrome swaps now; the session choice (including legacy
    // adoption and safe message loads) is reconciled for the new scope.
    set({
      activeScopeId: nextScopeId,
      scopeUI,
      panelOpen: ui.panelOpen,
      mini: { open: ui.miniOpen },
      agentMeta: IDLE_META,
      approvalResponder: null,
      pendingPrefill: null,
      pendingSelections: [],
    });
    reconcileActiveScope(get, set, nextScopeId);
  },


  patchDraft: (scopeId, patch) => {
    const prev = get().scopeDrafts[scopeId] ?? {
      value: "",
      files: [],
      pickedSnippets: [],
      pickedCommands: [],
    };
    set({ scopeDrafts: { ...get().scopeDrafts, [scopeId]: { ...prev, ...patch } } });
  },

  sessionsHydrated: false,
  sessions: [],
  activeSessionId: null,

  hydrateSessions: async () => {
    if (get().sessionsHydrated) return;
    const { sessions } = await loadAll();
    if (get().sessionsHydrated) return;

    // Load the persisted list, but never overwrite a session the store
    // already created: setActiveScope can run before this async hydrate
    // lands (App's tab effect is synchronous) and its fresh session would
    // otherwise be dropped, leaving activeSessionId pointing at an id that
    // no longer exists in the list.
    const existing = new Set(get().sessions.map((x) => x.id));
    const merged = [...get().sessions, ...sessions.filter((x) => !existing.has(x.id))];

    // A no-placeholder load: every session belongs to a scope, and the
    // first tab's setActiveScope (which adopts legacy scopeless rows) picks
    // or creates the right one.
    set({ sessions: merged, sessionsHydrated: true });

    // The scope may already be active (set before hydration): the early
    // return in setActiveScope would skip adoption of legacy rows and the
    // remembered-session restore, so re-run the reconcile explicitly. It
    // keeps a session already created for this scope.
    const scopeId = get().activeScopeId;
    if (scopeId !== null) {
      reconcileActiveScope(get, set, scopeId);
    }
  },
  newSession: () => {
    const id = newSessionId();
    const scopeId = get().activeScopeId ?? "";
    const meta: SessionMeta = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scopeId,
    };
    const next = [meta, ...get().sessions];
    set((s) => ({
      sessions: next,
      activeSessionId: id,
      agentMeta: IDLE_META,
      ...(scopeId !== "" && {
        scopeSessions: { ...s.scopeSessions, [scopeId]: id },
      }),
    }));
    void saveSessionsList(next);
    void saveActiveId(id);
    return id;
  },

  switchSession: (id) => {
    if (get().activeSessionId === id) return;
    const meta = get().sessions.find((s) => s.id === id);
    if (!meta) return;
    // A session belongs to one scope's chat; picking it from another scope's
    // picker would cross projects.
    const scopeId = get().activeScopeId;
    if (scopeId !== null && meta.scopeId !== "" && meta.scopeId !== scopeId)
      return;

    // Lazily seed the chat with persisted messages the first time we open
    // this session. Subsequent switches reuse the cached Chat instance.
    const flip = () => {
      set((s) => ({
        activeSessionId: id,
        agentMeta: IDLE_META,
        ...(scopeId !== null &&
          meta.scopeId === "" && {
            sessions: s.sessions.map((x) =>
              x.id === id ? { ...x, scopeId } : x,
            ),
          }),
        ...(scopeId !== null && {
          scopeSessions: { ...s.scopeSessions, [scopeId]: id },
        }),
      }));
      void saveActiveId(id);
    };
    if (chats.has(id) || seedMessages.has(id)) {
      flip();
      return;
    }
    void loadMessages(id)
      .then((m) => {
        // The user may have switched scopes while the messages loaded; only
        // flip when this session's scope is still the active one.
        if (get().activeScopeId !== scopeId) return;
        if (m && m.length > 0 && !chats.has(id)) seedMessages.set(id, m);
        flip();
      })
      .catch((error) => {
        // Stay on the current conversation: opening this one empty could later
        // overwrite a healthy file that was only momentarily unreadable.
        toast.error(t("toast.openConvFailed"), {
          id: `conversation-open:${id}`,
          description: String(error),
        });
      });
  },

  deleteSession: (id) => {
    const scopeId = get().sessions.find((s) => s.id === id)?.scopeId ?? "";
    const remaining = get().sessions.filter((s) => s.id !== id);
    chats.get(id)?.stop();
    chats.delete(id);
    seedMessages.delete(id);
    const pend = pendingPersist.get(id);
    if (pend) {
      clearTimeout(pend.timer);
      pendingPersist.delete(id);
    }
    lastPersistedAt.delete(id);
    void deleteSessionData(id);
    void useTodosStore.getState().clearSession(id);

    const scopeSessions = { ...get().scopeSessions };
    if (scopeSessions[scopeId] === id) delete scopeSessions[scopeId];

    // Deleting the last session of a scope replaces it with a fresh one in
    // that same scope; the user never lands in another project's chat.
    if (remaining.filter((s) => s.scopeId === scopeId).length === 0) {
      const fresh: SessionMeta = {
        id: newSessionId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scopeId,
      };
      set({
        sessions: [fresh, ...remaining],
        activeSessionId: fresh.id,
        scopeSessions: { ...scopeSessions, [scopeId]: fresh.id },
      });
      void saveSessionsList([fresh, ...remaining]);
      void saveActiveId(fresh.id);
      return;
    }

    const wasActive = get().activeSessionId === id;
    const sameScope = remaining.filter((s) => s.scopeId === scopeId);
    const nextActive = wasActive
      ? (sameScope[0]?.id ?? get().activeSessionId)
      : get().activeSessionId;
    if (wasActive && sameScope.length > 0) {
      scopeSessions[scopeId] = sameScope[0].id;
    }
    set({
      sessions: remaining,
      activeSessionId: nextActive,
      scopeSessions,
    });
    void saveSessionsList(remaining);
    if (wasActive) void saveActiveId(nextActive);
  },

  renameSession: (id, title) => {
    const next = get().sessions.map((s) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },

  persistMessages: (id, messages) => {
    // Streaming fires this per token; the write itself is scheduled.
    schedulePersist(id, messages);

    // Update zustand session list only when the derived title actually
    // changes — otherwise we'd rewrite the sessions array (and trigger
    // re-renders + a store write) on every token.
    const sessions = get().sessions;
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const isUntitled = !meta.title || meta.title === "New chat";
    if (!isUntitled) return;
    const nextTitle = deriveTitle(messages);
    if (nextTitle === meta.title) return;
    const next = sessions.map((s) =>
      s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },
}));

export function getActiveProviderKey(): string | null {
  const { selectedModelId, apiKeys, customEndpointKeys } =
    useChatStore.getState();
  if (isCompatModelId(selectedModelId)) {
    const eid = endpointIdFromCompatModel(selectedModelId);
    return customEndpointKeys[eid] ?? null;
  }
  return apiKeys[getModel(selectedModelId as ModelId).provider] ?? null;
}

export function getChat(sessionId?: string): Chat<UIMessage> | undefined {
  if (sessionId) return chats.get(sessionId);
  const id = useChatStore.getState().activeSessionId;
  return id ? chats.get(id) : undefined;
}

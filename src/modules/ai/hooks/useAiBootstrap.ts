import { t } from "@/i18n/zh";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { compatModelIdForEndpoint } from "../config";
import { getAllCustomEndpointKeys, getAllKeys } from "../lib/keyring";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";

/**
 * Startup wiring for the AI subsystem: loads provider keys (and keeps them in
 * sync), hydrates the preference store and mirrors the default model, hydrates
 * chat/agents/snippets stores, and fires any pending review for the active
 * session. Returns the two derived flags the shell needs.
 */
export function useAiBootstrap(): {
  hasComposer: boolean;
  keysLoaded: boolean;
} {
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  // A model exists only when at least one endpoint is fully configured.
  const hasEndpoint = customEndpoints.some(
    (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
  );
  const hasComposer = hasEndpoint;

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const loadProviderKeys = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
    };
    const reload = () => {
      loadProviderKeys();
      if (!usePreferencesStore.getState().hydrated) return;
      void getAllCustomEndpointKeys(
        usePreferencesStore.getState().customEndpoints,
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    loadProviderKeys();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys]);

  useEffect(() => {
    if (!prefsHydrated) return;
    let alive = true;
    void getAllCustomEndpointKeys(
      usePreferencesStore.getState().customEndpoints,
    ).then((epKeys) => {
      if (alive) setCustomEndpointKeys(epKeys);
    });
    return () => {
      alive = false;
    };
  }, [setCustomEndpointKeys, prefsHydrated]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    // No stored default (fresh install): adopt the first configured endpoint.
    if (prefDefaultModel) {
      setSelectedModelId(prefDefaultModel);
      return;
    }
    const first = customEndpoints.find(
      (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
    );
    if (first) setSelectedModelId(compatModelIdForEndpoint(first.id));
  }, [prefsHydrated, prefDefaultModel, customEndpoints, setSelectedModelId]);

  useEffect(() => {
    void hydrateSessions().catch((error: unknown) => {
      toast.error(t("toast.loadChatFailed"), {
        id: "chat-history-load",
        description: String(error),
      });
    });
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, [hydrateSessions]);

  return { hasComposer, keysLoaded };
}

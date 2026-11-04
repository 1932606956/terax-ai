import { getCustomEndpointKey } from "./keyring";
import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const MAX_MODELS = 500;

export type RemoteModel = {
  id: string;
  contextLimit?: number;
};

type OpenAiModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, "");
}

function extractModelIds(payload: unknown): string[] {
  const body = payload as OpenAiModelsResponse | null;
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of body.data) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

export function parseModelsPayload(payload: unknown): RemoteModel[] {
  return extractModelIds(payload)
    .slice(0, MAX_MODELS)
    .map((id) => ({ id }));
}

export async function fetchEndpointModels(
  baseURL: string,
  endpointId: string,
): Promise<RemoteModel[]> {
  const base = normalizeBaseURL(baseURL);
  const url = base.endsWith("/models") ? base : `${base}/models`;
  const headers: Record<string, string> = {};
  const key = await getCustomEndpointKey(endpointId);
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await localProxyFetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return parseModelsPayload(await res.json());
}

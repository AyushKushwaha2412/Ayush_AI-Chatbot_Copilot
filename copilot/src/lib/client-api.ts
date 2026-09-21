/**
 * Thin browser-side API client. Every call is same-origin ('/api/...'),
 * which matters in the hosted preview where the browser is NOT on the
 * sandbox host: relative URLs are proxied by the dev server.
 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data: data as T & { error?: string } };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) }),
  put: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(payload ?? {}) }),
  patch: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface AiStatus {
  ok: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'offline';
  connected: boolean;
  provider: string;
  model: string;
  activeProvider: string;
  activeModel: string;
  message: string;
  latencyMs: number | null;
  endpoint: string | null;
  models: { id: string; family: string | null }[];
  fallback: { provider: string; connected: boolean; model: string; message: string } | null;
  configuredProvider: string;
  fallbackEnabled: boolean;
  mode: 'copilot' | 'autopilot';
  resolvedChain: { provider: string; timeoutMs: number; temperature: number };
  observedAt: string;
}

export interface Meta {
  provider: string;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  warnings: string[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  autoSend: boolean;
}

export interface ReplyOption {
  id: string;
  style: string;
  label: string;
  body: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: string;
  autoSent: boolean;
  createdAt: string;
}

export interface GenerateResponse {
  ok: boolean;
  intent: string;
  read: string;
  replies: ReplyOption[];
  memoryUpdates: { id: string; label: string | null; value: string; kind: string }[];
  meta: Meta;
  error?: string;
}

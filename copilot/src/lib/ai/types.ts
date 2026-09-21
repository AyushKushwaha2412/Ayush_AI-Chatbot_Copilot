/**
 * Provider-agnostic LLM contract.
 *
 * Every provider (local Ollama, remote OpenAI-compatible, offline mock)
 * implements this interface, so the rest of the app never talks to a
 * vendor SDK directly. Credentials live only inside the server-side
 * provider instances — they are never returned in API responses.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the model for a strict JSON object response when supported. */
  json?: boolean;
  timeoutMs?: number;
  stop?: string[];
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  text: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  usage: ChatUsage;
  /** true when a fallback provider produced this result */
  fallbackUsed?: boolean;
  notes?: string[];
}

export type ProviderId = 'ollama' | 'openai' | 'mock';

export interface ProviderModel {
  id: string;
  label?: string;
  sizeBytes?: number;
  family?: string;
}

export interface HealthResult {
  ok: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'offline';
  provider: ProviderId;
  message: string;
  model: string;
  baseUrlMasked?: string;
  latencyMs?: number;
  models?: ProviderModel[];
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  /** Human-readable, credential-free endpoint description. */
  readonly endpoint: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  listModels(): Promise<ProviderModel[]>;
  health(): Promise<HealthResult>;
}

export interface ProviderCredentials {
  /** Remote API key. Server-side only. */
  apiKey?: string | null;
}

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly statusCode?: number;
  readonly kind: 'network' | 'auth' | 'rate-limit' | 'bad-response' | 'timeout' | 'unknown';

  constructor(
    message: string,
    provider: ProviderId,
    kind: ProviderError['kind'] = 'unknown',
    statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

/** Strip credentials from a URL before it is ever logged or returned. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '<invalid-url>';
  }
}

export function maskSecret(secret?: string | null): string | null {
  if (!secret) return null;
  const s = secret.trim();
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars/token heuristic, good enough for a usage counter on local models
  return Math.max(1, Math.round(text.length / 4));
}

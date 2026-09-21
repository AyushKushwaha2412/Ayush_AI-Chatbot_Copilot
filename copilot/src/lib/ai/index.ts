import { prisma } from '@/lib/db';
import { MockProvider } from './providers/mock';
import { OllamaProvider } from './providers/ollama';
import { OpenAICompatProvider } from './providers/openai';
import {
  ChatRequest,
  ChatResult,
  HealthResult,
  LlmProvider,
  ProviderError,
  ProviderId,
} from './types';

export * from './types';
export { MockProvider, OllamaProvider, OpenAICompatProvider };

export interface ProviderConfig {
  provider: ProviderId | 'auto';
  fallbackEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  /** resolved server-side only (DB value → env fallback) */
  openaiApiKey?: string | null;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
}

const DEFAULT_CONFIG: ProviderConfig = {
  provider: 'ollama',
  fallbackEnabled: true,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:8b',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  temperature: 0.85,
  maxTokens: 400,
  requestTimeoutMs: 60000,
};

/**
 * Loads provider configuration from the `ai_settings` table.
 * The API key is decrypted/read here on the server only — callers must never
 * pass the result straight into an HTTP response.
 */
export async function loadProviderConfig(): Promise<ProviderConfig> {
  const row = await prisma.aiSetting.findUnique({ where: { id: 'default' } });
  if (!row) return DEFAULT_CONFIG;
  return {
    provider: (row.provider as ProviderConfig['provider']) || 'ollama',
    fallbackEnabled: row.fallbackEnabled,
    ollamaBaseUrl: row.ollamaBaseUrl || DEFAULT_CONFIG.ollamaBaseUrl,
    ollamaModel: row.ollamaModel || DEFAULT_CONFIG.ollamaModel,
    openaiBaseUrl: row.openaiBaseUrl || DEFAULT_CONFIG.openaiBaseUrl,
    openaiModel: row.openaiModel || DEFAULT_CONFIG.openaiModel,
    openaiApiKey: row.openaiApiKey || process.env.OPENAI_API_KEY || '',
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    requestTimeoutMs: row.requestTimeoutMs,
  };
}

export function buildProvider(id: ProviderId, cfg: ProviderConfig): LlmProvider {
  switch (id) {
    case 'ollama':
      return new OllamaProvider(cfg.ollamaBaseUrl, cfg.ollamaModel);
    case 'openai':
      return new OpenAICompatProvider({
        baseUrl: cfg.openaiBaseUrl,
        model: cfg.openaiModel,
        apiKey: cfg.openaiApiKey,
      });
    case 'mock':
    default:
      return new MockProvider();
  }
}

/** Primary provider + ordered fallback chain derived from the config. */
export function resolveChain(cfg: ProviderConfig): LlmProvider[] {
  const chain: LlmProvider[] = [];

  if (cfg.provider === 'auto') {
    if (cfg.openaiApiKey) chain.push(buildProvider('openai', cfg));
    chain.push(buildProvider('ollama', cfg));
  } else {
    chain.push(buildProvider(cfg.provider, cfg));
  }

  if (cfg.fallbackEnabled && !chain.some((p) => p.id === 'mock')) {
    chain.push(buildProvider('mock', cfg));
  }
  return chain;
}

export interface GenerateOutcome {
  result: ChatResult;
  providerTried: ProviderId[];
  errors: { provider: ProviderId; message: string }[];
  fallbackUsed: boolean;
}

/**
 * Runs the provider chain until one succeeds. Failures are collected so the
 * UI can show *why* a fallback kicked in (e.g. "Ollama not running").
 */
export async function generate(
  req: Omit<ChatRequest, 'timeoutMs'>,
  cfg: ProviderConfig,
): Promise<GenerateOutcome> {
  const chain = resolveChain(cfg);
  const errors: { provider: ProviderId; message: string }[] = [];
  const tried: ProviderId[] = [];

  for (const provider of chain) {
    tried.push(provider.id);
    try {
      const result = await provider.chat({
        ...req,
        temperature: req.temperature ?? cfg.temperature,
        maxTokens: req.maxTokens ?? cfg.maxTokens,
        timeoutMs: cfg.requestTimeoutMs,
      });
      return {
        result: { ...result, fallbackUsed: trixIsFallback(provider.id, cfg.provider, tried) },
        providerTried: tried,
        errors,
        fallbackUsed: trixIsFallback(provider.id, cfg.provider, tried),
      };
    } catch (err) {
      const message =
        err instanceof ProviderError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown provider error';
      errors.push({ provider: provider.id, message });
    }
  }

  throw new ProviderError(
    `All providers failed: ${errors.map((e) => `${e.provider} → ${e.message}`).join(' | ')}`,
    chain[0]?.id ?? 'mock',
    'network',
  );
}

function trixIsFallback(used: ProviderId, configured: ProviderConfig['provider'], tried: ProviderId[]) {
  if (tried.length === 1) return false;
  if (configured === 'auto') return used === 'mock';
  return used !== configured;
}

export interface StatusReport {
  primary: HealthResult;
  fallback?: HealthResult;
  activeProvider: ProviderId;
  activeModel: string;
  observedAt: string;
}

/** Health-check the configured provider (used by the "Test connection" button). */
export async function providerStatus(): Promise<StatusReport> {
  const cfg = await loadProviderConfig();
  const chain = resolveChain(cfg);
  const primary = chain[0];
  const health = await primary.health();

  // if primary is down, probe the fallback so the UI can say what WILL be used
  let fallback: HealthResult | undefined;
  if (!health.ok && chain[1]) {
    fallback = await chain[1].health();
  }

  const active = health.ok ? primary : (chain[1] ?? primary);

  return {
    primary: health,
    fallback,
    activeProvider: active.id,
    activeModel: active.model,
    observedAt: new Date().toISOString(),
  };
}

/** Convenience for the AI route: config + chat in one call. */
export async function chatWithFallback(
  req: Omit<ChatRequest, 'timeoutMs'>,
): Promise<GenerateOutcome & { config: ProviderConfig }> {
  const config = await loadProviderConfig();
  const outcome = await generate(req, config);
  return { ...outcome, config };
}

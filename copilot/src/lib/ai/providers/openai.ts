import {
  ChatRequest,
  ChatResult,
  HealthResult,
  LlmProvider,
  ProviderError,
  ProviderModel,
  estimateTokens,
  maskUrl,
} from '../types';

/**
 * Optional remote provider for any OpenAI-compatible endpoint
 * (OpenAI, Groq, Together, OpenRouter, LM Studio, vLLM, ...).
 *
 * The API key is held only in the server process (DB row or env var) and is
 * never serialised into an HTTP response to the browser.
 */
export class OpenAICompatProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: {
    baseUrl?: string;
    model?: string;
    apiKey?: string | null;
    label?: string;
  }) {
    this.baseUrl = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = opts.model || 'gpt-4o-mini';
    this.apiKey = (opts.apiKey || '').trim();
    this.label = opts.label || `Remote (${maskUrl(this.baseUrl)})`;
  }

  get endpoint() {
    return `Remote · ${maskUrl(this.baseUrl)} · key ${this.apiKey ? 'configured' : 'missing'}`;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new ProviderError(
        'No API key configured for the remote provider. Add one in Settings (stored server-side only).',
        this.id,
        'auth',
      );
    }

    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.85,
      max_tokens: req.maxTokens ?? 400,
      stream: false,
    };
    if (req.json) body.response_format = { type: 'json_object' };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1000, req.timeoutMs ?? 60000)),
        cache: 'no-store',
      });
    } catch (err: unknown) {
      const e = err as Error;
      throw new ProviderError(
        e.name === 'TimeoutError'
          ? 'Remote provider timed out.'
          : `Cannot reach remote provider at ${maskUrl(this.baseUrl)}.`,
        this.id,
        e.name === 'TimeoutError' ? 'timeout' : 'network',
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const kind =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 429
            ? 'rate-limit'
            : 'bad-response';
      // never echo the key back, even if the vendor does
      throw new ProviderError(
        `Remote provider returned ${res.status}${detail ? `: ${redact(detail, this.apiKey).slice(0, 300)}` : ''}`,
        this.id,
        kind,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new ProviderError('Remote provider returned an empty completion.', this.id, 'bad-response');

    const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n'));
    const completionTokens = data.usage?.completion_tokens ?? estimateTokens(text);

    return {
      text,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - started,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
      },
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id?: string }[] };
      return (data.data ?? [])
        .map((m) => ({ id: m.id ?? '', label: m.id }))
        .filter((m) => m.id)
        .slice(0, 200);
    } catch {
      return [];
    }
  }

  async health(): Promise<HealthResult> {
    const started = Date.now();
    if (!this.apiKey) {
      return {
        ok: false,
        status: 'disconnected',
        provider: this.id,
        model: this.model,
        baseUrlMasked: maskUrl(this.baseUrl),
        message: 'No API key configured (set it in Settings — it stays on the server).',
      };
    }
    try {
      const models = await this.listModels();
      return {
        ok: true,
        status: 'connected',
        provider: this.id,
        model: this.model,
        baseUrlMasked: maskUrl(this.baseUrl),
        latencyMs: Date.now() - started,
        models,
        message: models.length
          ? `Connected to ${maskUrl(this.baseUrl)} — ${models.length} models visible.`
          : `Connected to ${maskUrl(this.baseUrl)}.`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'error',
        provider: this.id,
        model: this.model,
        baseUrlMasked: maskUrl(this.baseUrl),
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Provider unreachable',
      };
    }
  }
}

function redact(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

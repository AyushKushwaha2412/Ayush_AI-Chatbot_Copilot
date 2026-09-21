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
 * Local Ollama provider.
 *
 * Talks to Ollama's OpenAI-compatible surface, e.g.
 *   POST http://localhost:11434/v1/chat/completions
 * and uses the native /api/tags endpoint for model discovery + health.
 *
 * No API key required — the network boundary is your own machine.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  readonly label = 'Ollama (local)';
  readonly model: string;
  readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434/v1', model = 'qwen3:8b') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  get endpoint() {
    return `Local · ${maskUrl(this.baseUrl)}`;
  }

  private origin(): string {
    // strip a trailing /v1 so we can hit Ollama's native API
    return this.baseUrl.replace(/\/v1$/, '').replace(/\/$/, '');
  }

  private timeout(timeoutMs?: number) {
    return AbortSignal.timeout(Math.max(1000, timeoutMs ?? 60000));
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.85,
      max_tokens: req.maxTokens ?? 400,
      stream: false,
    };
    if (req.json) {
      body.response_format = { type: 'json_object' };
    }
    if (req.stop?.length) body.stop = req.stop;
    // qwen3 supports disabling the long "thinking" preamble for snappy chat replies
    body.options = { num_ctx: 8192 };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.timeout(req.timeoutMs),
        cache: 'no-store',
      });
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new ProviderError(
          `Ollama timed out. Is the model "${this.model}" pulled and loaded?`,
          this.id,
          'timeout',
        );
      }
      throw new ProviderError(
        `Cannot reach Ollama at ${maskUrl(this.baseUrl)}. Start it with "ollama serve".`,
        this.id,
        'network',
      );
    }

    if (!res.ok) {
      const detail = await safeText(res);
      const kind = res.status === 404 ? 'bad-response' : res.status === 429 ? 'rate-limit' : 'unknown';
      throw new ProviderError(
        `Ollama returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
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
    if (!text) {
      throw new ProviderError('Ollama returned an empty completion.', this.id, 'bad-response');
    }

    const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n'));
    const completionTokens = data.usage?.completion_tokens ?? estimateTokens(text);

    return {
      text: stripThinking(text),
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
    try {
      const res = await fetch(`${this.origin()}/api/tags`, {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        models?: { name?: string; model?: string; size?: number; details?: { family?: string } }[];
      };
      return (data.models ?? [])
        .map((m) => ({
          id: m.name ?? m.model ?? 'unknown',
          label: m.name ?? m.model,
          sizeBytes: m.size,
          family: m.details?.family,
        }))
        .filter((m) => m.id !== 'unknown');
    } catch {
      return [];
    }
  }

  async health(): Promise<HealthResult> {
    const started = Date.now();
    try {
      // Probe directly (rather than via listModels) so "unreachable" and
      // "reachable but empty" stay distinguishable.
      const res = await fetch(`${this.origin()}/api/tags`, {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new ProviderError(`Ollama responded ${res.status}`, this.id, 'bad-response', res.status);
      }
      const data = (await res.json()) as {
        models?: { name?: string; model?: string; size?: number; details?: { family?: string } }[];
      };
      const models: ProviderModel[] = (data.models ?? []).map((m) => ({
        id: m.name ?? m.model ?? 'unknown',
        label: m.name ?? m.model,
        sizeBytes: m.size,
        family: m.details?.family,
      }));
      const hasModel = models.some(
        (m) => m.id === this.model || m.id.split(':')[0] === this.model.split(':')[0],
      );
      return {
        ok: true,
        status: 'connected',
        provider: this.id,
        model: this.model,
        baseUrlMasked: maskUrl(this.baseUrl),
        latencyMs: Date.now() - started,
        models,
        message: hasModel
          ? `Connected to Ollama — model "${this.model}" is available.`
          : models.length
            ? `Ollama reachable, but "${this.model}" is not pulled. Run: ollama pull ${this.model}`
            : `Ollama reachable. No models found — run: ollama pull ${this.model}`,
      };
    } catch (err) {
      const reason =
        err instanceof ProviderError
          ? err.message
          : err instanceof Error && err.name === 'TimeoutError'
            ? 'timed out'
            : 'not reachable';
      return {
        ok: false,
        status: 'disconnected',
        provider: this.id,
        model: this.model,
        baseUrlMasked: maskUrl(this.baseUrl),
        latencyMs: Date.now() - started,
        message: `Ollama ${reason} at ${maskUrl(this.baseUrl)}. Start it with "ollama serve" and pull the model: ollama pull ${this.model}`,
      };
    }
  }
}

function stripThinking(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/^\s*Thinking\.\.\.[\s\S]*?\n\n/i, '')
    .trim();
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

import { NextRequest } from 'next/server';
import { chatWithFallback, loadProviderConfig, providerStatus } from '@/lib/ai';
import { body, json, route } from '@/lib/api';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({ provider: z.enum(['ollama', 'openai', 'mock', 'auto']).optional() });

/**
 * POST /api/ai/status/test — the "Test connection" button.
 * Runs a real round-trip completion, not just a ping, so a broken model
 * (e.g. missing `ollama pull`) surfaces before the user relies on it.
 */
export const POST = route(async (req: NextRequest) => {
  const input = schema.parse(await body(req).catch(() => ({})));
  const started = Date.now();
  const config = await loadProviderConfig();
  const report = await providerStatus();

  let roundTrip: Record<string, unknown> = { attempted: false };

  try {
    const outcome = await chatWithFallback({
      messages: [
        { role: 'system', content: 'You are a connectivity probe. Reply with exactly: OK' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 16,
      temperature: 0,
    });
    roundTrip = {
      attempted: true,
      success: true,
      provider: outcome.result.provider,
      model: outcome.result.model,
      latencyMs: outcome.result.latencyMs,
      fallbackUsed: outcome.fallbackUsed,
      sample: outcome.result.text.slice(0, 120),
      errors: outcome.errors,
    };
  } catch (err) {
    roundTrip = {
      attempted: true,
      success: false,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }

  return json({
    ok: report.primary.ok || Boolean((roundTrip as { success?: boolean }).success),
    probeProvider: input.provider ?? config.provider,
    transport: {
      provider: report.primary.provider,
      status: report.primary.status,
      connected: report.primary.ok,
      model: report.primary.model,
      message: report.primary.message,
      endpoint: report.primary.baseUrlMasked ?? null,
      modelsAvailable: report.primary.models?.length ?? 0,
      models: (report.primary.models ?? []).slice(0, 40).map((m) => m.id),
    },
    fallback: report.fallback
      ? { provider: report.fallback.provider, connected: report.fallback.ok, message: report.fallback.message }
      : null,
    roundTrip,
    elapsedMs: Date.now() - started,
    testedAt: new Date().toISOString(),
  });
});
